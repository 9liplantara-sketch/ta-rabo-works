#!/usr/bin/env node
/**
 * Phase M2 — member analysis scoring / sync / auth 検証
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  scoreMemberAssessment,
  buildTestQuestionnaireV1,
  parseNumericAnswer,
  buildAnswerLookup,
  normalizeHeaderKey,
} from '../lib/member-analysis-scoring.js';
import {
  normalizePersonName,
  parseAnsweredAt,
  PSYCH_SOURCE_GOOGLE_FORMS_SHEET,
  syncPsychAssessmentBatch,
  validateSyncResponseForTest,
} from '../lib/psych-assessments.js';
import {
  getMemberAnalysisSyncSecret,
  MEMBER_ANALYSIS_SECRET_HEADER,
  verifySyncSecret,
} from '../lib/member-analysis-sync-auth.js';
import {
  isQuestionnaireMappingReady,
  MEMBER_ANALYSIS_QUESTIONNAIRE_V1,
  getScoringItemCounts,
} from '../lib/member-analysis-questionnaire-v1.js';
import {
  buildSyntheticProductionRawAnswers,
  buildSyntheticFilteredRawAnswers,
  buildSyntheticRawAnswersWithPaddedKeys,
} from '../lib/member-analysis-fixture-scoring.js';
import {
  classifyAllSheetHeaders,
  classifySheetHeader,
  filterRawAnswersForSync,
  computeResponseContentHash,
  HEADER_CATEGORY,
} from '../lib/member-analysis-sheet-headers.js';
import { evaluateSyncNeed } from '../lib/member-analysis-gas-sync-logic.js';
import {
  resolveStudentLabel,
  getMemberAnalysisStudentOptions,
  buildMemberSelectOptionsFromStudents,
  resolveMemberSelectState,
  shouldFetchMemberAssessments,
  mapAssessmentRowToOption,
  resolveAssessmentSelectState,
  buildMemberAnalysisViewModelFromOption,
} from '../lib/member-analysis-ui-logic.js';

let passed = 0;
let failed = 0;

function assert(cond, label) {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}`);
  }
}

console.log('\n=== Phase M2: unit questionnaire (isolated) ===\n');

const q = buildTestQuestionnaireV1();
const sampleRaw = {
  BF_E1: 5,
  BF_E2: 2,
  BF_C1: 6,
  BF_A1: 4,
  BF_N1: 2,
  BF_O1: 7,
  RIASEC_R1: 3,
  RIASEC_I1: 5,
  RIASEC_A1: 4,
  RIASEC_S1: 2,
  RIASEC_E1: 3,
  RIASEC_C1: 1,
  SV_SD1: 5, SV_SD2: 6,
  SV_ST1: 4, SV_ST2: 5,
  SV_HE1: 3, SV_HE2: 3,
  SV_AC1: 5, SV_AC2: 4,
  SV_PO1: 2, SV_PO2: 3,
  SV_SE1: 4, SV_SE2: 5,
  SV_CO1: 3, SV_CO2: 2,
  SV_TR1: 2, SV_TR2: 3,
  SV_BE1: 5, SV_BE2: 6,
  SV_UN1: 5, SV_UN2: 5,
  RF_P1: 6, RF_P2: 5,
  RF_V1: 4, RF_V2: 3,
};

const scored = scoreMemberAssessment(sampleRaw, q);
assert(scored.scores.bigFive.extraversion === 5.5, 'unit: BIG FIVE extraversion reverse average');
assert(scored.scores.bigFive.emotionalStability === 6, 'unit: BIG FIVE emotionalStability reverse');

console.log('\n=== Phase M2: production questionnaire mapping ===\n');

const counts = getScoringItemCounts();
assert(isQuestionnaireMappingReady() === true, 'production mapping ready');
assert(counts.bigFive.total === 20, 'BIG FIVE 20 items');
assert(counts.riasec.total === 23, 'RIASEC 23 items total');
assert(counts.schwartz.total === 20, 'SCHWARTZ 20 items');
assert(counts.regulatoryFocus.byTrait.promotion === 5, 'promotion 5 items');
assert(MEMBER_ANALYSIS_QUESTIONNAIRE_V1.pendingAudit.length === 0, 'pendingAudit cleared');
assert(
  !(MEMBER_ANALYSIS_QUESTIONNAIRE_V1.scoreExcludeHeaders || []).includes('促進（Promotion）'),
  '促進（Promotion） not in scoreExcludeHeaders'
);
assert(MEMBER_ANALYSIS_QUESTIONNAIRE_V1.contextualHeaders.length === 17, 'contextual 17 headers');
assert(MEMBER_ANALYSIS_QUESTIONNAIRE_V1.rawExcludeHeaders.includes('列 94'), 'legacy 列 94 in rawExclude');

console.log('\n=== Phase M2: header classification ===\n');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureCsv = path.join(__dirname, '../test/fixtures/member-analysis-sheet-headers.csv');
const fixtureHeaders = fs.readFileSync(fixtureCsv, 'utf8').replace(/^\uFEFF/, '').split('\n')[0]
  .match(/("([^"]|"")*"|[^,]*)/g)
  .map((h) => h.replace(/^"|"$/g, '').replace(/""/g, '"').trim())
  .filter(Boolean);

const classified = classifyAllSheetHeaders(fixtureHeaders);
assert(classified.counts[HEADER_CATEGORY.SCORING] === 73, 'classification: scoring 73');
assert(classified.counts[HEADER_CATEGORY.META] === 2, 'classification: meta 2');
assert(classified.counts[HEADER_CATEGORY.CONTEXTUAL] === 17, 'classification: contextual 17');
assert(classified.counts[HEADER_CATEGORY.OBSOLETE_SCORING_EXCLUDED] === 3, 'classification: obsolete 3');
assert(classified.counts[HEADER_CATEGORY.LEGACY_IGNORED] === 1, 'classification: legacy 1');
assert(classified.unknown.length === 0, 'classification: unknown = 0');

const unknownTest = classifySheetHeader('将来追加された未知の質問');
assert(unknownTest === HEADER_CATEGORY.UNKNOWN, 'unknown header detection');

console.log('\n=== Phase M2: raw/hash filter ===\n');

const synthFull = buildSyntheticProductionRawAnswers();
const synthFiltered = buildSyntheticFilteredRawAnswers();

assert(!Object.prototype.hasOwnProperty.call(synthFiltered, '列 94'), '列 94 excluded from raw');
assert(synthFiltered['Q3. いまの体調/余裕度（0〜10：スライダー）'] === 7, 'contextual in raw');
assert(synthFiltered['抽象的な話は苦手だ 2'] === 3, 'obsolete in raw');

const hashWithContextual = computeResponseContentHash(filterRawAnswersForSync({
  ...synthFiltered,
  'Q2. 研究室で扱ってみたいテーマ（仮でOK）（記述：短文）': 'CHANGED',
}));
const hashOriginal = computeResponseContentHash(synthFiltered);
assert(hashWithContextual !== hashOriginal, 'contextual change affects hash');

const hashWithLegacy = computeResponseContentHash(filterRawAnswersForSync({
  ...synthFull,
  '列 94': 'different',
}));
assert(hashWithLegacy === hashOriginal, '列 94 excluded from hash');

console.log('\n=== Phase M2: production synthetic scoring ===\n');

const prodScored = scoreMemberAssessment(synthFiltered, MEMBER_ANALYSIS_QUESTIONNAIRE_V1);

assert(prodScored.scores.bigFive.extraversion === 5.3, 'synthetic: extraversion = 5.3');
assert(prodScored.warnings.length === 0, 'synthetic: full scoring answers → no warnings');
assert(
  classifySheetHeader('Q14. 卒業後を考えるときの気持ち') === HEADER_CATEGORY.CONTEXTUAL,
  'contextual header not scoring category'
);
assert(
  !getScoringItemCounts().bigFive.byTrait.openness
    || prodScored.scores.bigFive.openness !== null,
  'synthetic: openness scored from scale items only'
);

const padded = buildSyntheticRawAnswersWithPaddedKeys();
assert(
  scoreMemberAssessment(padded, MEMBER_ANALYSIS_QUESTIONNAIRE_V1).scores.bigFive.extraversion
    === prodScored.scores.bigFive.extraversion,
  'header trim: padded keys score same'
);

console.log('\n=== Phase M2: member analysis UI logic ===\n');

const TARO_ID = 'student-yoshifumi';
const TEST_ID = 'student-test';

const integrationStudents = [
  { id: TARO_ID, role: 'student', display_name: null, name: '田羅義史', email: '9liplant.ara@gmail.com' },
  { id: TEST_ID, role: 'student', display_name: null, name: 'テスト学生', email: 'wonderdesignlabo@gmail.com' },
];
const integrationAssessments = [
  { id: 'a1', respondent_name: '田羅義史', student_id: TARO_ID, answered_at: '2026-02-12T00:00:00Z', scores: { bigFive: {} } },
  { id: 'a2', respondent_name: '滝本陽也', student_id: null, answered_at: '2026-01-01T00:00:00Z', scores: {} },
  { id: 'a3', respondent_name: '木下涼', student_id: null, answered_at: '2026-01-02T00:00:00Z', scores: {} },
];

const integrationMemberOptions = buildMemberSelectOptionsFromStudents(integrationStudents);
assert(integrationMemberOptions.length === 2, 'integration: MEMBER options = students count only');
assert(
  JSON.stringify(integrationMemberOptions) === JSON.stringify([
    { value: TARO_ID, label: '田羅義史' },
    { value: TEST_ID, label: 'テスト学生' },
  ].sort((a, b) => a.label.localeCompare(b.label, 'ja'))),
  'integration: exact MEMBER options from students only',
);
const integrationLabels = new Set(integrationMemberOptions.map((o) => o.label));
assert(!integrationLabels.has('滝本陽也'), 'integration: 滝本陽也 not in MEMBER');
assert(!integrationLabels.has('木下涼'), 'integration: 木下涼 not in MEMBER');
for (const a of integrationAssessments) {
  if (!a.student_id) {
    assert(!integrationLabels.has(a.respondent_name), `integration: ${a.respondent_name} not from assessments`);
  }
}

const TARO_PROD = 'e5f733d2-094f-47fb-8d91-f78b85a4f068';
const TEST_PROD = 'f88db9a1-4cd7-48e4-b60f-04739bfd9d31';

const productionStudents = [
  { id: TARO_PROD, role: 'student', display_name: null, name: '田羅義史', email: '9liplant.ara@gmail.com' },
  { id: TEST_PROD, role: 'student', display_name: null, name: 'テスト学生', email: 'wonderdesignlabo@gmail.com' },
];
const prodOptions = buildMemberSelectOptionsFromStudents(productionStudents);
assert(prodOptions.length === 2, 'production: both Neon students in MEMBER');
assert(prodOptions.some((m) => m.value === TARO_PROD && m.label === '田羅義史'), 'production: 田羅義史 option');
assert(prodOptions.some((m) => m.value === TEST_PROD && m.label === 'テスト学生'), 'production: テスト学生 option');

assert(
  resolveStudentLabel({ display_name: null, name: '田羅義史', email: 'a@b.c' }) === '田羅義史',
  'display_name=null / nameあり → name表示',
);
assert(
  resolveStudentLabel({ display_name: '', name: '山田太郎', email: 'a@b.c' }) === '山田太郎',
  'display_name="" / nameあり → name表示',
);
assert(
  resolveStudentLabel({ display_name: null, name: '', email: 'only@email.example' }) === 'only@email.example',
  'nameなし / emailあり → email表示',
);
assert(
  resolveStudentLabel({ display_name: 'null', name: '田羅義史', email: 'a@b.c' }) === '田羅義史',
  'display_name="null" string → name fallback（田羅義史除外バグ修正）',
);

const neonStudents = [
  { id: TEST_PROD, role: 'student', display_name: 'テスト学生', name: 'Test Student' },
  { id: null, role: 'student', name: 'null' },
  { role: 'student', name: 'no-id' },
];
const memberOptions = getMemberAnalysisStudentOptions(neonStudents);
assert(memberOptions.length === 1, 'member options: only student.id あり');
assert(memberOptions[0].id === TEST_PROD, 'member option value = student.id');

const noAssessmentStudent = getMemberAnalysisStudentOptions([
  { id: 'no-data-student', role: 'student', name: 'データなし', email: 'nodata@example.com' },
]);
assert(noAssessmentStudent.length === 1, 'assessment 0件でも student option は残る');

const singleMemberState = resolveMemberSelectState(
  prodOptions.map((o) => ({ id: o.value, name: o.label })),
  null,
);
assert(prodOptions.some((m) => m.value === singleMemberState.memberId), 'initial member id from valid options');
assert(shouldFetchMemberAssessments(singleMemberState.memberId), 'member 選択時 fetch 対象');
assert(!shouldFetchMemberAssessments(''), 'empty studentId: no fetch');

const nullAssessment = mapAssessmentRowToOption({
  id: 'a1', student_id: null, answered_at: '2026-01-15T00:00:00Z', scores: {},
});
assert(nullAssessment === null, 'student_id=null assessment not a member option source');

const assessmentRows = [
  { id: 'assess-1', student_id: TARO_PROD, answered_at: '2026-01-15T10:00:00Z', scores: { bigFive: {} } },
];
const assessState = resolveAssessmentSelectState(assessmentRows, null);
assert(assessState.assessmentId === 'assess-1', 'single assessment auto-selected');
assert(assessState.options.length === 1, 'one assessment option');

const vm = buildMemberAnalysisViewModelFromOption(assessState.options[0], (id) =>
  prodOptions.find((m) => m.value === id)?.label || 'unknown',
);
assert(vm?.scores?.bigFive !== undefined, 'assessment → view model → chart path has scores');
assert(vm?.memberId === TARO_PROD, 'view model memberId from assessment row');

const emptyAssess = resolveAssessmentSelectState([], null);
assert(emptyAssess.assessmentId === null, 'zero assessments → empty state');

console.log('\n=== Phase M2: GAS sync logic (mirror) ===\n');

assert(
  evaluateSyncNeed({ syncId: '', status: '', storedHash: '', newHash: 'abc' }).needsSync === true,
  'GAS retry: no sync_id → sync'
);
assert(
  evaluateSyncNeed({ syncId: 'id-1', status: 'error', storedHash: 'h', newHash: 'h' }).needsSync === true,
  'GAS retry: error row retries even if hash unchanged'
);
assert(
  evaluateSyncNeed({ syncId: 'id-1', status: 'synced', storedHash: 'h', newHash: 'h' }).needsSync === false,
  'GAS skip: synced + hash unchanged'
);
assert(
  evaluateSyncNeed({ syncId: 'id-1', status: '', storedHash: 'h', newHash: 'h' }).needsSync === true,
  'GAS retry: empty status → sync'
);

const gasCode = fs.readFileSync(path.join(__dirname, '../gas/member-analysis-sync/Code.gs'), 'utf8');
assert(gasCode.includes('LockService.getDocumentLock'), 'GAS LockService used');
assert(gasCode.includes('tryLock'), 'GAS tryLock used');
assert(gasCode.includes('X-Member-Analysis-Secret'), 'GAS secret header unified');
assert(gasCode.includes('RAW_EXCLUDE_HEADERS'), 'GAS raw exclude list');

console.log('\n=== Phase M2: batch partial success ===\n');

const partialResponses = [
  {
    source_response_id: 'partial-ok',
    answered_at: '2026-01-15T10:00:00+09:00',
    respondent_name: 'SYNTHETIC DEMO',
    raw_answers: synthFiltered,
  },
  {
    source_response_id: '',
    answered_at: '2026-01-15T10:00:00+09:00',
    raw_answers: synthFiltered,
  },
  {
    source_response_id: 'partial-bad-date',
    answered_at: 'not-a-date',
    raw_answers: synthFiltered,
  },
];

let valOk = 0;
let valFail = 0;
for (const r of partialResponses) {
  if (validateSyncResponseForTest(r).ok) valOk += 1;
  else valFail += 1;
}
assert(valOk === 1 && valFail === 2, 'validation: 1 ok, 2 failed (no batch rollback)');

const partialBatch = await syncPsychAssessmentBatch({ responses: partialResponses });
assert(partialBatch.received === 3, 'batch received 3');
assert(partialBatch.results.length === 3, 'batch per-item results (no whole-batch rollback)');
const validationFails = partialBatch.results.filter(
  (r) => r.error === 'source_response_id is required' || r.error === 'answered_at is invalid',
);
assert(validationFails.length === 2, 'batch partial: 2 validation failures isolated');
const validItem = partialBatch.results.find((r) => r.source_response_id === 'partial-ok');
assert(validItem && !validationFails.includes(validItem), 'valid item passes validation (DB may fail separately)');

console.log('\n=== Phase M2: sync secret auth ===\n');

const savedSecret = process.env.MEMBER_ANALYSIS_SYNC_SECRET;
delete process.env.MEMBER_ANALYSIS_SYNC_SECRET;
assert(verifySyncSecret(undefined).status === 503, 'env secret missing → 503');
assert(verifySyncSecret(undefined).error === 'sync_secret_not_configured', 'env missing error code');

process.env.MEMBER_ANALYSIS_SYNC_SECRET = 'correct-secret-value';
assert(verifySyncSecret(undefined).status === 401, 'header missing → 401');
assert(verifySyncSecret('').status === 401, 'empty header → 401');
assert(verifySyncSecret('wrong-len').status === 401, 'wrong length secret → 401');
assert(verifySyncSecret('correct-secret-wrong').status === 401, 'same length wrong secret → 401');
assert(verifySyncSecret('correct-secret-value').ok === true, 'correct secret → ok');

process.env.MEMBER_ANALYSIS_SYNC_SECRET = savedSecret || '';

console.log('\n=== Phase M2: sync module import ===\n');

const syncModule = await import('../api/psych-assessments/sync.js');
assert(typeof syncModule.default === 'function', 'api/psych-assessments/sync.js imports resolve');

console.log('\n=== Phase M2: parse / normalize / secret header name ===\n');

assert(parseNumericAnswer('4', 1, 7) === 4, 'parse numeric in range');
assert(normalizeHeaderKey('  foo  ') === 'foo', 'normalizeHeaderKey trim');
assert(MEMBER_ANALYSIS_SECRET_HEADER === 'x-member-analysis-secret', 'secret header name');

const prevSecret = process.env.MEMBER_ANALYSIS_SYNC_SECRET;
process.env.MEMBER_ANALYSIS_SYNC_SECRET = 'unit-test-secret';
assert(getMemberAnalysisSyncSecret() === 'unit-test-secret', 'sync secret from env');
process.env.MEMBER_ANALYSIS_SYNC_SECRET = prevSecret || '';

const clientShape = {
  id: 1,
  student_id: 1,
  respondent_name: 'X',
  answered_at: '2026-01-15T00:00:00.000Z',
  scores: {},
  questionnaire_version: 'v1',
  scoring_version: 'v1',
};
assert(!('raw_answers' in clientShape), 'client map excludes raw_answers by design');

console.log('\n=== Phase M2: constants ===\n');
assert(PSYCH_SOURCE_GOOGLE_FORMS_SHEET === 'google_forms_sheet', 'psych source id');
assert(normalizePersonName('  山田　太郎 ') === normalizePersonName('山田 太郎'), 'name normalize');

console.log('\n=== Phase M2: Neon 実DB（任意）===\n');

if (process.env.DATABASE_URL && process.env.MEMBER_ANALYSIS_SYNC_SECRET) {
  const { getDb } = await import('../lib/db.js');
  const sql = getDb();
  const table = await sql`
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'psych_assessments'
    LIMIT 1
  `;
  if (!table.length) {
    console.log('  (skip) psych_assessments テーブル未作成');
  } else {
    const sourceId = `test-synthetic-${Date.now()}`;
    const batch = await syncPsychAssessmentBatch({
      responses: [{
        source_response_id: sourceId,
        answered_at: '2026-01-15T12:00:00+09:00',
        respondent_name: 'SYNTHETIC DEMO MEMBER',
        respondent_email: null,
        raw_answers: synthFiltered,
      }],
    });
    assert(batch.synced === 1, 'DB: synthetic batch synced');
    await sql`DELETE FROM psych_assessments WHERE source_response_id = ${sourceId}`;
  }
} else {
  console.log('  (skip) DATABASE_URL または MEMBER_ANALYSIS_SYNC_SECRET 未設定');
}

console.log('\n=== Phase M2: sheet header audit (synthetic fixture) ===\n');

const audit = spawnSync(process.execPath, ['scripts/audit-member-analysis-sheet.mjs', fixtureCsv], {
  cwd: path.join(__dirname, '..'),
  encoding: 'utf8',
});
if (audit.stdout) process.stdout.write(audit.stdout);
if (audit.stderr) process.stderr.write(audit.stderr);
assert(audit.status === 0, 'audit script PASS on synthetic sheet fixture');

console.log(`\n--- 結果: ${passed} passed, ${failed} failed ---\n`);
process.exit(failed ? 1 : 0);
