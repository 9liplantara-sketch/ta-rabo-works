#!/usr/bin/env node
/**
 * Phase 6A — assessment selection / intake sources / provenance / consent
 */
import {
  selectPsychAssessmentForAnalysis,
  getCurrentSemanticAssessmentCriteria,
  isPreferredCurrentSemanticAssessment,
} from '../lib/member-analysis-assessment-selection.js';
import {
  buildIntakeSourcesFromItemAnswers,
  buildIntakeSourceId,
  summarizeV3IntakeAiEligibility,
  INTAKE_SOURCE_KIND,
  INTAKE_EPISTEMIC_TYPE,
} from '../lib/member-qualitative-intake-sources.js';
import {
  evaluateLocalAiAnalysisConsent,
  resolveLocalAiAnalysisConsent,
  LOCAL_AI_ANALYSIS_PURPOSE,
  LOCAL_AI_ANALYSIS_POLICY_VERSION,
} from '../lib/member-local-ai-consent.js';
import {
  buildAllowedSourceIdSet,
  buildSourceMetaMap,
  formatSourcesForAiPrompt,
} from '../lib/member-qualitative-sources.js';
import {
  validateAiCandidate,
  validateSelfReportProvenance,
} from '../lib/member-qualitative-ai.js';
import { EVIDENCE_SOURCE_KINDS } from '../lib/member-qualitative-constants.js';
import { mapPsychAssessmentForClient } from '../lib/psych-assessments.js';
import { MEMBER_ANALYSIS_QUESTIONNAIRE_V3_ITEMS } from '../lib/member-analysis-questionnaire-v3-items.js';

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

const criteria = getCurrentSemanticAssessmentCriteria();

console.log('\n=== Phase 6A: master audit ===\n');
const summary = summarizeV3IntakeAiEligibility();
assert(summary.total === 118, `master total=118 (got ${summary.total})`);
assert(summary.scoringIncluded === 74, `scoring=74 (got ${summary.scoringIncluded})`);
assert(summary.nonScoring === 44, `non-scoring=44 (got ${summary.nonScoring})`);
assert(summary.aiEligible === 35, `aiEligible=35 (got ${summary.aiEligible})`);
assert(summary.aiInputTextItems === 34, `AI text items=34 (got ${summary.aiInputTextItems})`);
assert(EVIDENCE_SOURCE_KINDS.includes(INTAKE_SOURCE_KIND), 'EVIDENCE_SOURCE_KINDS includes intake_response');

console.log('\n=== Phase 6A: assessment selection ===\n');

const legacy = {
  id: 'legacy-1',
  response_schema_version: 'legacy-physical-v1',
  scoring_version: 'member-analysis-score-v1',
  questionnaire_version: 'member-analysis-2026-v1',
  academic_year: 2025,
  answered_at: '2026-06-01T00:00:00.000Z',
  created_at: '2026-06-01T00:00:00.000Z',
  item_answers: {},
  scores: { bigFive: { openness: 0.5 } },
};

const v3Older = {
  id: 'v3-old',
  response_schema_version: criteria.responseSchemaVersion,
  scoring_version: criteria.scoringVersion,
  questionnaire_version: criteria.questionnaireVersion,
  academic_year: 2025,
  answered_at: '2025-12-01T00:00:00.000Z',
  created_at: '2025-12-01T00:00:00.000Z',
  item_answers: { 'SEED-01': 'old' },
  scores: {},
};

const v3Current = {
  id: 'v3-new',
  response_schema_version: criteria.responseSchemaVersion,
  scoring_version: criteria.scoringVersion,
  questionnaire_version: criteria.questionnaireVersion,
  academic_year: 2026,
  answered_at: '2026-04-01T00:00:00.000Z',
  created_at: '2026-04-02T00:00:00.000Z',
  item_answers: { 'SEED-01': 'new', 'ADM-01': '名' },
  scores: { bigFive: { openness: 0.8 } },
};

const future = {
  id: 'future-1',
  response_schema_version: 'semantic-itemid-v9',
  scoring_version: 'member-analysis-score-v9',
  questionnaire_version: 'member-analysis-2099-v9',
  academic_year: 2099,
  answered_at: '2099-01-01T00:00:00.000Z',
  created_at: '2099-01-01T00:00:00.000Z',
  item_answers: { 'SEED-01': 'future' },
  scores: {},
};

{
  const r = selectPsychAssessmentForAnalysis([legacy, v3Current]);
  assert(r.selection === 'current_semantic' && r.assessment.id === 'v3-new', 'v3 + legacy → v3 selected');
}
{
  const r = selectPsychAssessmentForAnalysis([legacy]);
  assert(r.selection === 'legacy_fallback' && r.assessment.id === 'legacy-1', 'legacy only → fallback');
}
{
  const r = selectPsychAssessmentForAnalysis([v3Older, v3Current]);
  assert(r.assessment.id === 'v3-new', 'multiple current → academic_year/latest wins');
}
{
  const r = selectPsychAssessmentForAnalysis([legacy, v3Current, future]);
  assert(r.selection === 'current_semantic' && r.assessment.id === 'v3-new', 'future incompatible does not win');
  assert(!isPreferredCurrentSemanticAssessment(future), 'future not preferred current');
}

console.log('\n=== Phase 6A: intake filtering ===\n');

const scoringItem = MEMBER_ANALYSIS_QUESTIONNAIRE_V3_ITEMS.find((i) => i.scoringIncluded && !i.aiEligible);
const nonAi = MEMBER_ANALYSIS_QUESTIONNAIRE_V3_ITEMS.find((i) => !i.aiEligible && !i.scoringIncluded);
const checkboxAi = MEMBER_ANALYSIS_QUESTIONNAIRE_V3_ITEMS.find(
  (i) => i.aiEligible && i.responseType === 'checkbox',
);
const textAi = MEMBER_ANALYSIS_QUESTIONNAIRE_V3_ITEMS.find(
  (i) => i.aiEligible && (i.responseType === 'text' || i.responseType === 'paragraph'),
);

const answers = {
  [textAi.id]: 'ガラスが好きです',
  [scoringItem.id]: '5',
  [nonAi.id]: 'should exclude',
  [checkboxAi.id]: 'a,b',
  'UNKNOWN-99': 'fabricated',
  'SEED-EMPTY': '',
};
// empty known text item if exists
const emptyText = MEMBER_ANALYSIS_QUESTIONNAIRE_V3_ITEMS.find(
  (i) => i.aiEligible && i.responseType === 'paragraph' && i.id !== textAi.id,
);
if (emptyText) answers[emptyText.id] = '   ';

const built = buildIntakeSourcesFromItemAnswers({
  assessmentId: 'assess-1',
  itemAnswers: answers,
  answeredAt: '2026-04-01T00:00:00.000Z',
});

assert(built.sources.some((s) => s.itemId === textAi.id), 'aiEligible text → included');
assert(!built.sources.some((s) => s.itemId === scoringItem.id), 'scoring raw → excluded');
assert(!built.sources.some((s) => s.itemId === nonAi.id), 'non-aiEligible → excluded');
assert(!built.sources.some((s) => s.itemId === checkboxAi.id), 'aiEligible checkbox → excluded');
assert(built.skipped.some((s) => s.itemId === 'UNKNOWN-99' && s.reason === 'unknown_item_id'), 'unknown item_id skipped');
if (emptyText) {
  assert(built.skipped.some((s) => s.itemId === emptyText.id && s.reason === 'empty_answer'), 'empty text excluded');
}
assert(built.sources.every((s) => s.sourceKind === INTAKE_SOURCE_KIND), 'source_kind=intake_response');
assert(built.sources.every((s) => s.epistemicType === INTAKE_EPISTEMIC_TYPE), 'epistemic_type=self_report');
assert(built.sources.every((s) => s.question && s.itemId), 'question metadata resolved from master');

const formatted = formatSourcesForAiPrompt(built.sources);
assert(formatted[0].item_id && formatted[0].question && formatted[0].epistemic_type === 'self_report', 'AI prompt format additive fields');

console.log('\n=== Phase 6A: provenance ===\n');

const allowed = buildAllowedSourceIdSet(built.sources);
const meta = buildSourceMetaMap(built.sources);
const goodId = buildIntakeSourceId('assess-1', textAi.id);
const goodCandidate = {
  category: 'interest',
  statement: 'ガラス素材への関心を自己申告している',
  epistemic_type: 'self_report',
  confidence: 'medium',
  relation_type: 'new',
  related_item_id: null,
  evidence: [{ source_kind: INTAKE_SOURCE_KIND, source_id: goodId, evidence_role: 'supports' }],
};
assert(validateAiCandidate(goodCandidate, allowed, meta).ok, 'intake source ID allowed → accepted');

const fakeCandidate = {
  ...goodCandidate,
  evidence: [{ source_kind: INTAKE_SOURCE_KIND, source_id: 'fabricated:FAKE', evidence_role: 'supports' }],
};
assert(!validateAiCandidate(fakeCandidate, allowed, meta).ok, 'fabricated source ID → rejected');

const prov = validateSelfReportProvenance('self_report', goodCandidate.evidence, meta);
assert(prov.ok, 'self_report provenance preserved for intake_response');

console.log('\n=== Phase 6A: consent ===\n');

assert(evaluateLocalAiAnalysisConsent({ status: 'active', purpose: LOCAL_AI_ANALYSIS_PURPOSE, policy_version: LOCAL_AI_ANALYSIS_POLICY_VERSION }).permitted, 'active → permitted');
assert(!evaluateLocalAiAnalysisConsent(null).permitted, 'missing → rejected');
assert(evaluateLocalAiAnalysisConsent(null).reason === 'consent_absent', 'missing reason=consent_absent');
assert(!evaluateLocalAiAnalysisConsent({ status: 'withdrawn' }).permitted, 'withdrawn → rejected');
assert(!evaluateLocalAiAnalysisConsent({ status: 'mystery' }).permitted, 'unknown → rejected');
assert(!evaluateLocalAiAnalysisConsent({}).permitted, 'empty status → unknown rejected');

{
  const mockOk = await resolveLocalAiAnalysisConsent('stu-1', { provider: 'mock' });
  assert(mockOk.permitted && mockOk.reason === 'mock_provider_exempt', 'mock provider exempt');
  const lw = await resolveLocalAiAnalysisConsent('stu-1', { provider: 'local_worker' });
  assert(!lw.permitted && lw.reason === 'consent_absent', 'local_worker absent → fail-closed');
}

console.log('\n=== Phase 6A: client map does not expose item_answers ===\n');
const client = mapPsychAssessmentForClient({
  ...v3Current,
  item_answers: { 'SEED-01': 'secret' },
});
assert(!('item_answers' in client) && !('itemAnswers' in client), 'mapPsychAssessmentForClient omits item_answers');

console.log(`\n--- 結果: ${passed} passed, ${failed} failed ---\n`);
if (failed) process.exit(1);
