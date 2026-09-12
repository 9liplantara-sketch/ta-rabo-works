#!/usr/bin/env node
/**
 * Qualitative analysis source preflight — auth / privacy / no-write / no-PII
 */
import { readFileSync } from 'node:fs';
import { assertQualitativeAdmin } from '../lib/member-qualitative-access.js';
import {
  computeAnalysisSourceIsolation,
  buildQualitativePreflightPayload,
} from '../lib/member-qualitative-preflight.js';
import {
  buildIntakeSourcesFromItemAnswers,
  isAiIntakeTextItem,
} from '../lib/member-qualitative-intake-sources.js';
import { MEMBER_ANALYSIS_QUESTIONNAIRE_V3_ITEMS } from '../lib/member-analysis-questionnaire-v3-items.js';
import {
  mapDailyReportToKnowledgeSource,
  mapKnowledgeRecordToSource,
} from '../lib/knowledge-sources.js';
import { filterDailyReportsForAnalysis } from '../lib/member-qualitative-sources.js';
import {
  LOCAL_AI_ANALYSIS_POLICY_VERSION,
  assertConsentStudentExistsOrThrow,
  __testSetConsentStudentLookup,
  __testResetConsentStudentLookup,
} from '../lib/member-local-ai-consent.js';
import {
  QUESTIONNAIRE_VERSION as V3,
  SCORING_VERSION as SCORING_V3,
} from '../lib/member-analysis-questionnaire-v3.js';
import { RESPONSE_SCHEMA_SEMANTIC_ITEMID_V3 } from '../lib/member-analysis-response-schema.js';

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

const STUDENT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const STUDENT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ASSESS_A = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ASSESS_B = '99999999-9999-4999-8999-999999999999';
const DAILY_A_LAB = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const DAILY_A_PRIVATE = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const DAILY_B_LAB = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const KR_A = '11111111-1111-4111-8111-111111111111';
const KR_B = '22222222-2222-4222-8222-222222222222';

console.log('\n=== Preflight: authorization helpers ===\n');

try {
  assertQualitativeAdmin(null);
  assert(false, 'null user → throw');
} catch (e) {
  assert(e.status === 401, 'unauthenticated → 401');
}

try {
  assertQualitativeAdmin({ role: 'student', email: 's@example.com' });
  assert(false, 'student → throw');
} catch (e) {
  assert(e.status === 403, 'student → 403');
}

assert(
  (() => {
    try {
      assertQualitativeAdmin({ role: 'admin', email: 'a@example.com' });
      return true;
    } catch {
      return false;
    }
  })(),
  'admin → ok',
);

console.log('\n=== Preflight: student_id validation ===\n');

try {
  await assertConsentStudentExistsOrThrow('not-a-uuid');
  assert(false, 'invalid uuid should throw');
} catch (e) {
  assert(e.status === 400 && e.code === 'invalid_student_id', 'invalid student_id → 400');
}

__testSetConsentStudentLookup(async () => null);
try {
  await assertConsentStudentExistsOrThrow(STUDENT_A);
  assert(false, 'unknown student should throw');
} catch (e) {
  assert(e.status === 404 && e.code === 'student_not_found', 'unknown student → 404');
}
__testResetConsentStudentLookup();

__testSetConsentStudentLookup(async (id) => ({ id, is_active: true }));
{
  const student = await assertConsentStudentExistsOrThrow(STUDENT_A);
  assert(student.id === STUDENT_A, 'known student → ok');
}
__testResetConsentStudentLookup();

const apiSrc = readFileSync(new URL('../api/psych-assessments.js', import.meta.url), 'utf8');
assert(apiSrc.includes("'qualitative-preflight'"), 'API registers qualitative-preflight');
assert(apiSrc.includes('runQualitativeAnalysisPreflight'), 'API calls preflight runner');
assert(!apiSrc.includes('api/member-analysis-preflight'), 'no new function entrypoint');

const preflightLib = readFileSync(new URL('../lib/member-qualitative-preflight.js', import.meta.url), 'utf8');
assert(preflightLib.includes('fetchAnalysisContextForStudent'), 'reuses analysis context');
assert(!preflightLib.includes('enqueueLocalWorkerAnalysis'), 'does not enqueue analysis');
assert(!preflightLib.includes('INSERT INTO member_analysis_runs'), 'no run INSERT');
assert(!preflightLib.includes('INSERT INTO member_profile'), 'no profile INSERT');
assert(!preflightLib.includes('recordConsentEpisode'), 'no consent write');

console.log('\n=== Preflight: v3 master AI-eligible constants ===\n');

const items = MEMBER_ANALYSIS_QUESTIONNAIRE_V3_ITEMS;
const scoring = items.filter((i) => i.scoringIncluded === true).length;
const nonScoring = items.filter((i) => i.scoringIncluded !== true).length;
const aiEligible = items.filter((i) => i.aiEligible === true).length;
const aiText = items.filter((i) => isAiIntakeTextItem(i)).length;
const vsnap = items.find((i) => i.id === 'VSNAP-01');
assert(items.length === 118, 'master total = 118');
assert(scoring === 74, 'scoring = 74');
assert(nonScoring === 44, 'non-scoring = 44');
assert(aiEligible === 35, 'aiEligible = 35');
assert(aiText === 34, 'AI text = 34');
assert(vsnap && vsnap.aiEligible === true && vsnap.responseType === 'checkbox', 'VSNAP-01 excluded non-text');

console.log('\n=== Preflight: isolation synthetic ===\n');

const dailyRows = [
  {
    id: DAILY_A_LAB,
    student_id: STUDENT_A,
    student_name: 'StudentA',
    visibility: 'lab',
    report_date: '2026-09-01',
    did_today: 'A lab',
    went_well: '',
    stuck_points: '',
    next_action: '',
    related_project: '',
    session_key: null,
    created_at: '2026-09-01T12:00:00.000Z',
  },
  {
    id: DAILY_A_PRIVATE,
    student_id: STUDENT_A,
    student_name: 'StudentA',
    visibility: 'private',
    report_date: '2026-09-02',
    did_today: 'A private SECRET',
    went_well: '',
    stuck_points: '',
    next_action: '',
    related_project: '',
    session_key: null,
    created_at: '2026-09-02T12:00:00.000Z',
  },
  {
    id: DAILY_B_LAB,
    student_id: STUDENT_B,
    student_name: 'StudentB',
    visibility: 'lab',
    report_date: '2026-09-01',
    did_today: 'B lab',
    went_well: '',
    stuck_points: '',
    next_action: '',
    related_project: '',
    session_key: null,
    created_at: '2026-09-01T12:00:00.000Z',
  },
];

const shareableOnly = filterDailyReportsForAnalysis(dailyRows)
  .map(mapDailyReportToKnowledgeSource)
  .filter(Boolean);
const targetDaily = shareableOnly.filter((s) =>
  (s.participants || []).some((p) => p.studentId === STUDENT_A),
);

assert(targetDaily.length === 1, 'filter keeps only shareable A daily');
assert(
  !shareableOnly.some((s) => s.sourceId === DAILY_A_PRIVATE),
  'private daily excluded by analysis filter',
);

const krA = mapKnowledgeRecordToSource({
  id: KR_A,
  record_type: 'one_on_one',
  title: 'A meeting',
  occurred_at: '2026-09-01T00:00:00.000Z',
  body_text: 'A body',
  visibility: 'lab',
  participants: [{ studentId: STUDENT_A, name: 'A' }],
});
const krB = mapKnowledgeRecordToSource({
  id: KR_B,
  record_type: 'one_on_one',
  title: 'B meeting',
  occurred_at: '2026-09-01T00:00:00.000Z',
  body_text: 'B body SECRET',
  visibility: 'lab',
  participants: [{ studentId: STUDENT_B, name: 'B' }],
});

const intakeAnswers = {};
for (const def of items) {
  if (isAiIntakeTextItem(def)) {
    intakeAnswers[def.id] = `answer for ${def.id}`;
  }
}
const intakeA = buildIntakeSourcesFromItemAnswers({
  assessmentId: ASSESS_A,
  itemAnswers: intakeAnswers,
  answeredAt: '2026-09-01T00:00:00.000Z',
  questionnaireVersion: V3,
});
const intakeB = buildIntakeSourcesFromItemAnswers({
  assessmentId: ASSESS_B,
  itemAnswers: { [Object.keys(intakeAnswers)[0]]: 'B only' },
  answeredAt: '2026-09-01T00:00:00.000Z',
  questionnaireVersion: V3,
});

assert(intakeA.intakeResponseCount === 34, 'full v3 text answers → 34 AI-eligible sources');

const goodSources = [...targetDaily, krA, ...intakeA.sources];
const goodIsolation = computeAnalysisSourceIsolation(STUDENT_A, goodSources, {
  selectedAssessmentId: ASSESS_A,
});
assert(goodIsolation.private_daily_included === 0, 'good set: private daily = 0');
assert(goodIsolation.cross_student_daily === 0, 'good set: cross daily = 0');
assert(goodIsolation.cross_student_knowledge === 0, 'good set: cross knowledge = 0');
assert(goodIsolation.cross_student_intake === 0, 'good set: cross intake = 0');

const leaked = [
  ...goodSources,
  {
    sourceKind: 'daily_report',
    sourceId: DAILY_A_PRIVATE,
    visibility: 'private',
    participants: [{ studentId: STUDENT_A, name: 'A' }],
  },
  mapDailyReportToKnowledgeSource(dailyRows.find((r) => r.id === DAILY_B_LAB)),
  krB,
  ...intakeB.sources,
].filter(Boolean);

const leakedIso = computeAnalysisSourceIsolation(STUDENT_A, leaked, {
  selectedAssessmentId: ASSESS_A,
});
assert(leakedIso.private_daily_included === 1, 'leak detects private daily');
assert(leakedIso.cross_student_daily >= 1, 'leak detects cross daily');
assert(leakedIso.cross_student_knowledge === 1, 'leak detects cross knowledge');
assert(leakedIso.cross_student_intake >= 1, 'leak detects cross intake');

console.log('\n=== Preflight: payload redaction ===\n');

const payload = buildQualitativePreflightPayload({
  studentId: STUDENT_A,
  consentStatus: {
    decision: { permitted: true, reason: 'consent_active' },
    active: {
      status: 'active',
      policy_version: LOCAL_AI_ANALYSIS_POLICY_VERSION,
      source: 'admin_recorded',
    },
  },
  context: {
    sources: goodSources,
    sourceCount: goodSources.length,
    dailyReportCount: targetDaily.length,
    knowledgeRecordCount: 1,
    intakeResponseCount: intakeA.intakeResponseCount,
    assessmentSelection: 'current_semantic',
    psych: {
      id: ASSESS_A,
      questionnaire_version: V3,
      scoring_version: SCORING_V3,
      response_schema_version: RESPONSE_SCHEMA_SEMANTIC_ITEMID_V3,
      scores: { extraversion: 5.0 },
      respondent_name: 'Secret Name',
    },
    confirmed: [{ id: 'p1', statement: 'secret statement', status: 'confirmed' }],
  },
  window: { fromDate: '2026-08-25', toDate: '2026-09-01' },
});

const serialized = JSON.stringify(payload);
assert(payload.ok === true, 'payload ok');
assert(payload.consent.permitted === true, 'consent permitted');
assert(payload.consent.reason === 'consent_active', 'consent reason');
assert(payload.sources.psych_assessment.exists === true, 'psych exists');
assert(payload.sources.psych_assessment.questionnaire_version === V3, 'psych questionnaire');
assert(payload.sources.intake.semantic_v3 === true, 'intake semantic v3');
assert(payload.sources.intake.ai_eligible_count === 34, 'intake ai eligible count');
assert(payload.sources.daily.shareable_count === 1, 'daily shareable count');
assert(payload.sources.knowledge.count === 1, 'knowledge count');
assert(payload.sources.confirmed_profile.count === 1, 'confirmed profile count only');
assert(payload.isolation.private_daily_included === 0, 'payload isolation private=0');
assert(payload.source_count === goodSources.length, 'source_count');
assert(payload.ready === true, 'ready true');
assert(!serialized.includes('Secret Name'), 'no respondent_name');
assert(!serialized.includes('secret statement'), 'no profile statement');
assert(!serialized.includes('extraversion'), 'no scores');
assert(!serialized.includes('A body'), 'no knowledge body');
assert(!serialized.includes('A lab'), 'no daily body');
assert(!serialized.includes('answer for'), 'no intake body');
assert(!serialized.includes('"scores"'), 'no scores key');
assert(!serialized.includes('item_answers'), 'no item_answers');
assert(!('sources' in payload && Array.isArray(payload.sources)), 'no raw sources array in payload');

console.log(`\n--- 結果: ${passed} passed, ${failed} failed ---\n`);
process.exit(failed > 0 ? 1 : 0);
