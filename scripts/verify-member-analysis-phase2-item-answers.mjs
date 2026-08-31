#!/usr/bin/env node
/**
 * Phase 2 — item_answers 経路検証（v1 互換 + v3 item_answers pipeline）
 * Phase 3 scoring 自体は verify:member-analysis-v3-scoring で検証。
 *
 *   npm run verify:member-analysis-phase2-item-answers
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  QUESTIONNAIRE_VERSION_V3,
  EXPECTED_V3_ACTIVE_ITEM_COUNT,
  auditActiveMappingForItemAnswers,
  buildItemAnswersFromMapping,
  candidateAnswerHeadersForMappingRow,
  filterActiveMappedRows,
  isV3QuestionnaireVersion,
  validateItemAnswersField,
} from '../lib/member-analysis-item-answers.js';
import { SCORING_VERSION as SCORING_VERSION_V3 } from '../lib/member-analysis-questionnaire-v3.js';
import { scoreMemberAssessmentV3 } from '../lib/member-analysis-scoring-v3.js';
import { parseGoogleFormMappingCsv } from '../lib/member-analysis-v3-form-mapping.js';
import { parseItemMasterCsv } from '../lib/member-analysis-v3-item-master.js';
import {
  validateSyncResponseForTest,
  resolveSyncQuestionnaireVersion,
} from '../lib/psych-assessments.js';
import {
  buildSyntheticFilteredRawAnswers,
} from '../lib/member-analysis-fixture-scoring.js';
import { computeResponseContentHash } from '../lib/member-analysis-sheet-headers.js';
import { MEMBER_ANALYSIS_QUESTIONNAIRE_V1 } from '../lib/member-analysis-questionnaire-v1.js';
import { scoreMemberAssessment } from '../lib/member-analysis-scoring.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mappingPath = path.join(__dirname, '../test/fixtures/member-analysis-v3-google-form-mapping.csv');
const masterPath = path.join(__dirname, '../test/fixtures/member-analysis-v3-item-master.csv');

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

console.log('\n=== Phase 2: fixture / mapping ===\n');

const mappingRows = parseGoogleFormMappingCsv(fs.readFileSync(mappingPath, 'utf8'), {
  excludeOrphans: false,
});
const masterRows = parseItemMasterCsv(fs.readFileSync(masterPath, 'utf8'));
const active = filterActiveMappedRows(mappingRows);
const audit = auditActiveMappingForItemAnswers(active);

assert(mappingRows.length === 130, 'mapping total 130');
assert(active.length === 118, 'active mapped 118');
assert(audit.ok, 'active mapping audit PASS');
assert(audit.uniqueItemIds === 118, 'unique item_id 118');
assert(masterRows.length === 118, 'master 118');

console.log('\n=== Phase 2: build item_answers ===\n');

/** 構造的候補ヘッダーで synthetic raw_answers を構築（Forms 列名を模擬） */
const syntheticRaw = {};
for (const row of active) {
  const candidates = candidateAnswerHeadersForMappingRow(row);
  const header = candidates[0];
  assert(!!header, `candidate header for ${row.item_id}`);
  // 値は item_id ごとに一意にして解決確認しやすくする
  syntheticRaw[header] = row.item_id.startsWith('B5-') || row.item_id.startsWith('VAL-')
    || row.item_id.startsWith('RF-') || row.item_id.startsWith('RIA-')
    ? 4
    : `answer:${row.item_id}`;
}

const built = buildItemAnswersFromMapping(syntheticRaw, mappingRows);
assert(built.ok, 'buildItemAnswersFromMapping ok');
assert(built.unresolvedItemIds.length === 0, 'unresolved = 0');
assert(Object.keys(built.itemAnswers || {}).length === EXPECTED_V3_ACTIVE_ITEM_COUNT, 'item_answers count 118');
assert(new Set(Object.keys(built.itemAnswers || {})).size === 118, 'no duplicate item_id');

const missingMaster = masterRows.filter((m) => !(m.item_id in built.itemAnswers));
assert(missingMaster.length === 0, 'all master item_ids present in item_answers');

console.log('\n=== Phase 2: API validation ===\n');

const v1Raw = buildSyntheticFilteredRawAnswers();
const v1Item = {
  source_response_id: 'phase2-v1',
  answered_at: '2026-01-15T10:00:00+09:00',
  respondent_name: 'SYNTHETIC DEMO',
  raw_answers: v1Raw,
};
assert(validateSyncResponseForTest(v1Item).ok, 'v1 without item_answers → PASS');
assert(
  validateSyncResponseForTest(v1Item, { questionnaireVersion: MEMBER_ANALYSIS_QUESTIONNAIRE_V1.questionnaire_version }).ok,
  'v1 explicit version without item_answers → PASS',
);

const v3Missing = {
  ...v1Item,
  source_response_id: 'phase2-v3-missing',
};
assert(
  !validateSyncResponseForTest(v3Missing, { questionnaireVersion: QUESTIONNAIRE_VERSION_V3 }).ok,
  'v3 without item_answers → FAIL',
);

const v3Ok = {
  source_response_id: 'phase2-v3-ok',
  answered_at: '2026-01-15T10:00:00+09:00',
  respondent_name: 'SYNTHETIC DEMO',
  raw_answers: syntheticRaw,
  item_answers: built.itemAnswers,
};
const v3Validated = validateSyncResponseForTest(v3Ok, { questionnaireVersion: QUESTIONNAIRE_VERSION_V3 });
assert(v3Validated.ok, 'v3 with item_answers → PASS');
assert(v3Validated.value?.itemAnswers && Object.keys(v3Validated.value.itemAnswers).length === 118, 'v3 validated item_answers 118');

assert(validateItemAnswersField(null, { required: false }).ok, 'item_answers optional when not required');
assert(!validateItemAnswersField(null, { required: true }).ok, 'item_answers required when required');
assert(!validateItemAnswersField([], { required: true }).ok, 'item_answers array rejected');

console.log('\n=== Phase 2: v1 hash / scoring unchanged ===\n');

const hashA = computeResponseContentHash(v1Raw);
const hashB = computeResponseContentHash(v1Raw);
assert(hashA === hashB, 'v1 raw_answers hash stable');
assert(!String(JSON.stringify(v1Raw)).includes('item_answers'), 'raw_answers object has no item_answers key');

const scored = scoreMemberAssessment(v1Raw, MEMBER_ANALYSIS_QUESTIONNAIRE_V1);
assert(!!scored.scoring_version, 'v1 scorer still runs');
assert(isV3QuestionnaireVersion(QUESTIONNAIRE_VERSION_V3), 'v3 version detector');
assert(!isV3QuestionnaireVersion(MEMBER_ANALYSIS_QUESTIONNAIRE_V1.questionnaire_version), 'v1 not detected as v3');

console.log('\n=== Phase 2/3: v3 scoring integration (Phase 3) ===\n');

// Phase 2: item_answers 118 必須は維持。Phase 3 以降 sync 経路は v3 scorer を使用（deferred ではない）。
const v3Scored = scoreMemberAssessmentV3(built.itemAnswers);
assert(v3Scored.ok, 'v3 item_answers → scoreMemberAssessmentV3 ok');
assert(v3Scored.scoring_version === SCORING_VERSION_V3, 'v3 scoring_version = member-analysis-score-v3');
assert(v3Scored.scores?.bigFive?.extraversion != null, 'v3 scores populated');
assert(resolveSyncQuestionnaireVersion(QUESTIONNAIRE_VERSION_V3).kind === 'v3', 'sync router v3');

const psychCode = fs.readFileSync(path.join(__dirname, '../lib/psych-assessments.js'), 'utf8');
assert(psychCode.includes('scoreMemberAssessmentV3'), 'psych-assessments uses v3 scorer');
assert(!psychCode.includes('SCORING_VERSION_V3_DEFERRED'), 'psych-assessments no longer defers v3 scoring');

console.log('\n=== Phase 2: GAS payload markers ===\n');

const gasCode = fs.readFileSync(path.join(__dirname, '../gas/member-analysis-sync/Code.gs'), 'utf8');
assert(gasCode.includes('buildItemAnswersFromMappingRows_'), 'GAS builds item_answers');
assert(gasCode.includes('getSyncQuestionnaireVersion_'), 'GAS questionnaire version router');
assert(gasCode.includes('loadValidatedV3MappingRowsForSync_'), 'GAS fail-closed mapping validation');
assert(gasCode.includes('computeResponseHash_'), 'GAS hash function present');
// hash は responseMap のみ — item_answers を hash 入力に含めない
const hashFn = gasCode.slice(gasCode.indexOf('function computeResponseHash_'), gasCode.indexOf('function pickMetaValue_'));
assert(!hashFn.includes('item_answers'), 'GAS hash does not include item_answers');

console.log('\n=== Phase 2: v3 sync payload preview (dry-run) ===\n');

assert(gasCode.includes('function previewMemberAnalysisV3SyncPayload'), 'GAS previewMemberAnalysisV3SyncPayload present');
assert(gasCode.includes('buildSyncPayload_(chunk, headerMap)'), 'preview reuses buildSyncPayload_');
const previewStart = gasCode.indexOf('function previewMemberAnalysisV3SyncPayload');
const previewBlock = gasCode.slice(previewStart);
assert(!previewBlock.includes('UrlFetchApp.fetch'), 'preview does not call UrlFetchApp.fetch');
assert(!previewBlock.includes('syncMemberAnalysisResponsesCore_'), 'preview does not invoke production sync core');
assert(previewBlock.includes('buildSyncPayload_'), 'preview builds payload via buildSyncPayload_');
assert(previewBlock.includes('buildResponseMap_'), 'preview uses buildResponseMap_');
assert(!previewBlock.includes('ensureSyncColumns_'), 'preview does not ensure sync columns (no sheet write)');
assert(!previewBlock.includes('.setValue('), 'preview does not write sheet cells');
assert(gasCode.includes('v3 Sync Payload プレビュー'), 'menu item for v3 sync payload preview');

console.log('\n=== Phase 2: schema ===\n');

const schema = fs.readFileSync(path.join(__dirname, '../db/schema.sql'), 'utf8');
const migration = fs.readFileSync(
  path.join(__dirname, '../db/migrations/2026-08-psych-assessments-item-answers.sql'),
  'utf8',
);
assert(schema.includes('item_answers JSONB'), 'schema.sql has item_answers');
assert(migration.includes('ADD COLUMN IF NOT EXISTS item_answers'), 'migration adds item_answers');
assert(migration.includes('backfill') || migration.includes('NULL'), 'migration notes no backfill / NULL');

console.log(`\n=== Phase 2 item_answers: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed ? 1 : 0);
