#!/usr/bin/env node
/**
 * Unified source / provenance audit — synthetic cross-student fixture
 * No Production DB write / no consent / no Ollama.
 */
import { readFileSync } from 'node:fs';
import { isDailyReportEligibleForKnowledge, canViewKnowledgeRecord } from '../lib/knowledge-access.js';
import {
  mapDailyReportToKnowledgeSource,
  mapKnowledgeRecordToSource,
} from '../lib/knowledge-sources.js';
import {
  buildIntakeSourcesFromItemAnswers,
  buildIntakeSourceId,
  parseIntakeSourceId,
  parseIntakeEvidenceSourceId,
  INTAKE_SOURCE_KIND,
} from '../lib/member-qualitative-intake-sources.js';
import {
  buildAllowedSourceIdSet,
  filterDailyReportsForAnalysis,
} from '../lib/member-qualitative-sources.js';
import {
  isDailyEvidenceOwnedAndEligible,
  isKnowledgeEvidenceOwnedAndViewable,
  resolveIntakeEvidenceDetailFromAssessment,
  partitionEvidenceByAccessibility,
} from '../lib/member-qualitative-evidence.js';
import {
  computeAnalysisInputFingerprint,
  buildFingerprintPartsFromSources,
} from '../lib/member-qualitative-worker.js';
import { mapPsychAssessmentForClient } from '../lib/psych-assessments.js';
import { selectPsychAssessmentForAnalysis } from '../lib/member-analysis-assessment-selection.js';
import {
  QUESTIONNAIRE_VERSION as V3,
  SCORING_VERSION as SCORING_V3,
} from '../lib/member-analysis-questionnaire-v3.js';
import { RESPONSE_SCHEMA_SEMANTIC_ITEMID_V3 } from '../lib/member-analysis-response-schema.js';
import { EVIDENCE_SOURCE_KINDS } from '../lib/member-qualitative-constants.js';
import { CANDIDATES_JSON_SCHEMA } from '../lib/member-qualitative-ollama.js';
import { validateAiCandidate } from '../lib/member-qualitative-ai.js';
import { buildSourceMetaMap } from '../lib/member-qualitative-sources.js';

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
const DAILY_A_LAB = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const DAILY_A_PRIVATE = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const DAILY_A_PUBLIC = 'abababab-abab-4aba-8aba-abababababab';
const DAILY_B_LAB = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const KR_A = '11111111-1111-4111-8111-111111111111';
const KR_B = '22222222-2222-4222-8222-222222222222';
const INTAKE_ITEM = 'ADM-01';
const ASSESS_B = '99999999-9999-4999-8999-999999999999';

const admin = { role: 'admin', id: 'admin-1' };

const dailyRows = [
  {
    id: DAILY_A_LAB,
    student_id: STUDENT_A,
    student_name: 'StudentA',
    visibility: 'lab',
    report_date: '2026-09-01',
    did_today: 'A lab work',
    went_well: 'ok',
    stuck_points: '',
    next_action: '',
    related_project: '',
    session_key: null,
    created_at: '2026-09-01T10:00:00.000Z',
    updated_at: '2026-09-01T10:00:00.000Z',
  },
  {
    id: DAILY_A_PRIVATE,
    student_id: STUDENT_A,
    student_name: 'StudentA',
    visibility: 'private',
    report_date: '2026-09-01',
    did_today: 'SECRET private body must never enter AI',
    went_well: '',
    stuck_points: '',
    next_action: '',
    related_project: '',
    session_key: null,
    created_at: '2026-09-01T11:00:00.000Z',
    updated_at: '2026-09-01T11:00:00.000Z',
  },
  {
    id: DAILY_A_PUBLIC,
    student_id: STUDENT_A,
    student_name: 'StudentA',
    visibility: 'public',
    report_date: '2026-09-01',
    did_today: 'A public work',
    went_well: '',
    stuck_points: '',
    next_action: '',
    related_project: '',
    session_key: null,
    created_at: '2026-09-01T11:30:00.000Z',
    updated_at: '2026-09-01T11:30:00.000Z',
  },
  {
    id: DAILY_B_LAB,
    student_id: STUDENT_B,
    student_name: 'StudentB',
    visibility: 'lab',
    report_date: '2026-09-01',
    did_today: 'B SECRET lab body cross-student',
    went_well: '',
    stuck_points: '',
    next_action: '',
    related_project: '',
    session_key: null,
    created_at: '2026-09-01T12:00:00.000Z',
    updated_at: '2026-09-01T12:00:00.000Z',
  },
];

const knowledgeRecords = [
  {
    id: KR_A,
    record_type: 'transcript',
    title: 'A 1:1 transcript',
    occurred_at: '2026-09-01T09:00:00.000Z',
    body_text: 'Transcript text for A only (no audio file)',
    summary_text: null,
    decisions_text: null,
    next_actions_text: null,
    session_key: null,
    visibility: 'lab',
    created_at: '2026-09-01T09:00:00.000Z',
    updated_at: '2026-09-01T09:00:00.000Z',
    participants: [{ studentId: STUDENT_A, name: 'StudentA' }],
  },
  {
    id: KR_B,
    record_type: 'meeting_minutes',
    title: 'B meeting',
    occurred_at: '2026-09-01T08:00:00.000Z',
    body_text: 'Minutes SECRET for B only',
    summary_text: null,
    decisions_text: null,
    next_actions_text: null,
    session_key: null,
    visibility: 'lab',
    created_at: '2026-09-01T08:00:00.000Z',
    updated_at: '2026-09-01T08:00:00.000Z',
    participants: [{ studentId: STUDENT_B, name: 'StudentB' }],
  },
];

const psychA = {
  id: ASSESS_A,
  student_id: STUDENT_A,
  answered_at: '2026-09-01T07:00:00.000Z',
  questionnaire_version: V3,
  scoring_version: SCORING_V3,
  response_schema_version: RESPONSE_SCHEMA_SEMANTIC_ITEMID_V3,
  scores: { bigFive: { openness: 4.2 } },
  item_answers: { [INTAKE_ITEM]: 'I prefer structured research plans.' },
  created_at: '2026-09-01T07:00:00.000Z',
  updated_at: '2026-09-01T07:00:00.000Z',
};

const psychB = {
  id: ASSESS_B,
  student_id: STUDENT_B,
  answered_at: '2026-09-01T06:00:00.000Z',
  questionnaire_version: V3,
  scoring_version: SCORING_V3,
  response_schema_version: RESPONSE_SCHEMA_SEMANTIC_ITEMID_V3,
  scores: {},
  item_answers: { [INTAKE_ITEM]: 'B SECRET intake answer' },
  created_at: '2026-09-01T06:00:00.000Z',
  updated_at: '2026-09-01T06:00:00.000Z',
};

/**
 * Mirrors analysis assembly rules without DB:
 * daily.student_id + privacy filter
 * knowledge participants.student_id + visibility
 * psych.student_id + intake from same assessment
 */
function assembleAnalysisContext(studentId, { daily, knowledge, psychRows }) {
  const reports = filterDailyReportsForAnalysis(
    (daily || []).filter((r) => String(r.student_id) === String(studentId)),
  )
    .map(mapDailyReportToKnowledgeSource)
    .filter(Boolean);

  const records = (knowledge || [])
    .filter((r) =>
      (r.participants || []).some(
        (p) => String(p.studentId || p.student_id || '') === String(studentId),
      ),
    )
    .filter((r) => canViewKnowledgeRecord(admin, r))
    .map(mapKnowledgeRecordToSource)
    .filter(Boolean);

  const { assessment, selection } = selectPsychAssessmentForAnalysis(
    (psychRows || []).filter((r) => String(r.student_id) === String(studentId)),
  );

  let psych = null;
  let intakeSources = [];
  if (assessment) {
    psych = mapPsychAssessmentForClient(assessment);
    if (selection === 'current_semantic') {
      intakeSources = buildIntakeSourcesFromItemAnswers({
        assessmentId: assessment.id,
        itemAnswers: assessment.item_answers,
        answeredAt: assessment.answered_at,
        questionnaireVersion: assessment.questionnaire_version,
      }).sources;
    }
  }

  const sources = [...reports, ...records, ...intakeSources];
  return {
    sources,
    allowedSourceIds: buildAllowedSourceIdSet(sources),
    dailyReportCount: reports.length,
    knowledgeRecordCount: records.length,
    intakeResponseCount: intakeSources.length,
    sourceCount: sources.length,
    psych,
    assessmentSelection: selection,
    fingerprint: computeAnalysisInputFingerprint(sources),
  };
}

console.log('\n=== Unified sources: privacy helpers ===\n');
assert(isDailyReportEligibleForKnowledge({ visibility: 'lab' }), 'lab daily eligible');
assert(isDailyReportEligibleForKnowledge({ visibility: 'public' }), 'public daily eligible');
assert(!isDailyReportEligibleForKnowledge({ visibility: 'private' }), 'private daily NOT eligible');
assert(
  !filterDailyReportsForAnalysis(dailyRows).some((r) => r.id === DAILY_A_PRIVATE),
  'filterDailyReportsForAnalysis drops private',
);

console.log('\n=== Unified sources: Student A context ===\n');
const ctxA = assembleAnalysisContext(STUDENT_A, {
  daily: dailyRows,
  knowledge: knowledgeRecords,
  psychRows: [psychA],
});

assert(!!ctxA.psych && ctxA.psych.id === ASSESS_A, 'A psych YES');
assert(!('item_answers' in (ctxA.psych || {})), 'client psych map omits item_answers');
assert(ctxA.intakeResponseCount >= 1, 'A intake YES');
assert(
  ctxA.sources.some((s) => s.sourceKind === 'daily_report' && s.sourceId === DAILY_A_LAB),
  'A lab daily YES',
);
assert(
  ctxA.sources.some((s) => s.sourceKind === 'daily_report' && s.sourceId === DAILY_A_PUBLIC),
  'A public daily YES',
);
assert(
  !ctxA.sources.some((s) => s.sourceId === DAILY_A_PRIVATE),
  'A private daily NO',
);
assert(
  !ctxA.sources.some((s) => String(s.bodyText || '').includes('SECRET private')),
  'private body never in AI sources',
);
assert(
  ctxA.sources.some((s) => s.sourceKind === 'knowledge_record' && s.sourceId === KR_A),
  'A knowledge YES',
);
assert(
  !ctxA.sources.some((s) => s.sourceId === DAILY_B_LAB || s.sourceId === KR_B),
  'B sources ZERO in A context',
);
assert(ctxA.dailyReportCount === 2, 'A daily_report_count=2 (lab+public)');
assert(ctxA.knowledgeRecordCount === 1, 'A knowledge_record_count=1');
assert(ctxA.sourceCount === ctxA.dailyReportCount + ctxA.knowledgeRecordCount + ctxA.intakeResponseCount, 'source_count sums parts');

console.log('\n=== Unified sources: Student B leakage check ===\n');
const ctxB = assembleAnalysisContext(STUDENT_B, {
  daily: dailyRows,
  knowledge: knowledgeRecords,
  psychRows: [psychA, psychB],
});
assert(!ctxB.psych || ctxB.psych.id === ASSESS_B, 'B psych is B only');
assert(ctxB.intakeResponseCount >= 1, 'B has own intake');
assert(
  ctxB.sources.every((s) => {
    if (s.sourceKind === 'daily_report') return s.sourceId === DAILY_B_LAB;
    if (s.sourceKind === 'knowledge_record') return s.sourceId === KR_B;
    if (s.sourceKind === INTAKE_SOURCE_KIND) return String(s.sourceId).startsWith(`${ASSESS_B}:`);
    return false;
  }),
  'B context only B-owned sources',
);
assert(
  !ctxB.allowedSourceIds.has(`daily_report:${DAILY_A_LAB}`)
    && !ctxB.allowedSourceIds.has(`knowledge_record:${KR_A}`)
    && ![...ctxB.allowedSourceIds].some((k) => k.startsWith(`${INTAKE_SOURCE_KIND}:${ASSESS_A}`)),
  'A identifiers absent from B allowed set',
);

console.log('\n=== Unified sources: provenance formats ===\n');
const intakeId = buildIntakeSourceId(ASSESS_A, INTAKE_ITEM);
assert(parseIntakeSourceId(intakeId)?.assessmentId === ASSESS_A, 'intake source_id parseable');
assert(ctxA.allowedSourceIds.has(`daily_report:${DAILY_A_LAB}`), 'daily UUID provenance key');
assert(ctxA.allowedSourceIds.has(`knowledge_record:${KR_A}`), 'knowledge UUID provenance key');
assert(ctxA.allowedSourceIds.has(`${INTAKE_SOURCE_KIND}:${intakeId}`), 'intake composite provenance key');
assert(
  EVIDENCE_SOURCE_KINDS.includes('daily_report')
    && EVIDENCE_SOURCE_KINDS.includes('knowledge_record')
    && EVIDENCE_SOURCE_KINDS.includes('intake_response'),
  'EVIDENCE_SOURCE_KINDS includes all three',
);

console.log('\n=== Unified sources: run metadata / no body in fingerprint ===\n');
const parts = buildFingerprintPartsFromSources(ctxA.sources);
assert(parts.every((p) => p.sourceKind && p.sourceId), 'fingerprint parts have kind+id');
assert(
  !JSON.stringify(parts).includes('A lab work')
    && !JSON.stringify(parts).includes('Transcript text')
    && !JSON.stringify(parts).includes('structured research'),
  'fingerprint parts contain no source bodies',
);
assert(/^[a-f0-9]{64}$/.test(ctxA.fingerprint), 'fingerprint is sha256 hex');
assert(
  ctxA.psych?.id === ASSESS_A,
  'psych_assessment_id aligns with selected assessment',
);

console.log('\n=== Unified sources: isolation / immutability (static) ===\n');
const schema = readFileSync('db/schema.sql', 'utf8');
const evidenceBlock = schema.split('CREATE TABLE IF NOT EXISTS member_profile_evidence')[1].split('CREATE TABLE')[0];
assert(evidenceBlock.includes('source_kind') && evidenceBlock.includes('source_id'), 'evidence has provenance cols');
assert(!/body_text|item_answers|did_today/.test(evidenceBlock), 'evidence has no body duplication cols');

const runsBlock = schema.split('CREATE TABLE IF NOT EXISTS member_analysis_runs')[1].split('CREATE TABLE')[0];
assert(runsBlock.includes('student_id'), 'runs.student_id');
assert(runsBlock.includes('source_count'), 'runs.source_count');
assert(runsBlock.includes('daily_report_count'), 'runs.daily_report_count');
assert(runsBlock.includes('knowledge_record_count'), 'runs.knowledge_record_count');
assert(runsBlock.includes('psych_assessment_id'), 'runs.psych_assessment_id');
assert(runsBlock.includes('input_fingerprint'), 'runs.input_fingerprint');
assert(!/body_text|sources_json|prompt_text/.test(runsBlock), 'runs store no full text payload');

const worker = readFileSync('lib/member-qualitative-worker.js', 'utf8');
assert(!/UPDATE\s+psych_assessments/i.test(worker), 'worker does not UPDATE psych_assessments');
assert(!/INSERT\s+INTO\s+psych_assessments/i.test(worker), 'worker does not INSERT psych_assessments');

const ollama = readFileSync('lib/member-qualitative-ollama.js', 'utf8');
const schemaEnum = CANDIDATES_JSON_SCHEMA.properties.candidates.items.properties.evidence.items.properties.source_kind.enum;
assert(
  schemaEnum.includes('daily_report')
    && schemaEnum.includes('knowledge_record')
    && schemaEnum.includes('intake_response'),
  'Ollama schema allows intake_response',
);
assert(schemaEnum.length === 3, 'Ollama source_kind enum exactly 3 kinds');

console.log('\n=== Provenance hardening: owner validation ===\n');

const dailyById = new Map(dailyRows.map((r) => [r.id, r]));
const knowledgeById = new Map(knowledgeRecords.map((r) => [r.id, r]));
const intakeA = buildIntakeSourceId(ASSESS_A, INTAKE_ITEM);
const intakeB = buildIntakeSourceId(ASSESS_B, INTAKE_ITEM);

assert(isDailyEvidenceOwnedAndEligible(dailyById.get(DAILY_A_LAB), STUDENT_A), 'A→A lab daily YES');
assert(isDailyEvidenceOwnedAndEligible(dailyById.get(DAILY_A_PUBLIC), STUDENT_A), 'A→A public daily YES');
assert(!isDailyEvidenceOwnedAndEligible(dailyById.get(DAILY_A_PRIVATE), STUDENT_A), 'A→A private daily NO');
assert(!isDailyEvidenceOwnedAndEligible(dailyById.get(DAILY_B_LAB), STUDENT_A), 'A→B lab daily NO');
assert(
  isKnowledgeEvidenceOwnedAndViewable(knowledgeById.get(KR_A), admin, STUDENT_A),
  'A→A knowledge YES',
);
assert(
  !isKnowledgeEvidenceOwnedAndViewable(knowledgeById.get(KR_B), admin, STUDENT_A),
  'A→B knowledge NO',
);

const okIntake = resolveIntakeEvidenceDetailFromAssessment({
  sourceId: intakeA,
  assessment: psychA,
  expectedStudentId: STUDENT_A,
  user: admin,
});
assert(okIntake.accessible === true && okIntake.detail?.bodyText?.includes('structured'), 'A→A intake YES');

const crossIntake = resolveIntakeEvidenceDetailFromAssessment({
  sourceId: intakeB,
  assessment: psychB,
  expectedStudentId: STUDENT_A,
  user: admin,
});
assert(crossIntake.accessible === false && crossIntake.detail == null, 'A→B intake NO');
assert(!JSON.stringify(crossIntake).includes('B SECRET'), 'B intake body not returned on cross-student');

const { accessible: ownedAcc, inaccessible: ownedInacc } = partitionEvidenceByAccessibility(
  [
    { source_kind: 'daily_report', source_id: DAILY_A_LAB },
    { source_kind: 'daily_report', source_id: DAILY_A_PRIVATE },
    { source_kind: 'daily_report', source_id: DAILY_B_LAB },
    { source_kind: 'knowledge_record', source_id: KR_A },
    { source_kind: 'knowledge_record', source_id: KR_B },
    { source_kind: INTAKE_SOURCE_KIND, source_id: intakeA },
    { source_kind: INTAKE_SOURCE_KIND, source_id: intakeB },
  ],
  dailyById,
  knowledgeById,
  admin,
  new Set([intakeA]),
  STUDENT_A,
);
assert(ownedAcc.some((e) => e.source_id === DAILY_A_LAB), 'partition A lab accessible');
assert(ownedAcc.some((e) => e.source_id === KR_A), 'partition A knowledge accessible');
assert(ownedAcc.some((e) => e.source_id === intakeA), 'partition A intake accessible');
assert(ownedInacc.some((e) => e.source_id === DAILY_A_PRIVATE), 'partition A private inaccessible');
assert(ownedInacc.some((e) => e.source_id === DAILY_B_LAB), 'partition B daily inaccessible for A');
assert(ownedInacc.some((e) => e.source_id === KR_B), 'partition B knowledge inaccessible for A');
assert(ownedInacc.some((e) => e.source_id === intakeB), 'partition B intake inaccessible for A');

console.log('\n=== Provenance hardening: intake failure cases ===\n');
assert(parseIntakeEvidenceSourceId(null) == null, 'malformed null');
assert(parseIntakeEvidenceSourceId('') == null, 'malformed empty');
assert(parseIntakeEvidenceSourceId('no-colon') == null, 'malformed no colon');
assert(parseIntakeEvidenceSourceId(':ITEM') == null, 'malformed empty assessment');
assert(parseIntakeEvidenceSourceId('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:') == null, 'malformed empty item');
assert(parseIntakeEvidenceSourceId('not-uuid:ADM-01') == null, 'malformed non-UUID assessment');

assert(
  resolveIntakeEvidenceDetailFromAssessment({
    sourceId: 'bad',
    assessment: psychA,
    expectedStudentId: STUDENT_A,
    user: admin,
  }).accessible === false,
  'malformed source_id → inaccessible',
);
assert(
  resolveIntakeEvidenceDetailFromAssessment({
    sourceId: buildIntakeSourceId('ffffffff-ffff-4fff-8fff-ffffffffffff', INTAKE_ITEM),
    assessment: null,
    expectedStudentId: STUDENT_A,
    user: admin,
  }).accessible === false,
  'unknown assessment → inaccessible',
);
assert(
  resolveIntakeEvidenceDetailFromAssessment({
    sourceId: buildIntakeSourceId(ASSESS_A, 'UNKNOWN-ITEM'),
    assessment: psychA,
    expectedStudentId: STUDENT_A,
    user: admin,
  }).accessible === false,
  'unknown itemId → inaccessible',
);

console.log('\n=== Provenance hardening: Ollama citation validation ===\n');
const meta = buildSourceMetaMap(ctxA.sources);
const allowed = ctxA.allowedSourceIds;
assert(
  validateAiCandidate({
    category: 'interest',
    statement: 'lab note',
    epistemic_type: 'observed_pattern',
    confidence: 'medium',
    relation_type: 'new',
    evidence: [{ source_kind: 'daily_report', source_id: DAILY_A_LAB, evidence_role: 'supports' }],
  }, allowed, meta).ok,
  'daily_report citation PASS',
);
assert(
  validateAiCandidate({
    category: 'interest',
    statement: 'kr note',
    epistemic_type: 'observed_pattern',
    confidence: 'medium',
    relation_type: 'new',
    evidence: [{ source_kind: 'knowledge_record', source_id: KR_A, evidence_role: 'supports' }],
  }, allowed, meta).ok,
  'knowledge_record citation PASS',
);
assert(
  validateAiCandidate({
    category: 'interest',
    statement: 'intake note',
    epistemic_type: 'self_report',
    confidence: 'medium',
    relation_type: 'new',
    evidence: [{ source_kind: INTAKE_SOURCE_KIND, source_id: intakeA, evidence_role: 'supports' }],
  }, allowed, meta).ok,
  'intake_response citation PASS',
);
assert(
  !validateAiCandidate({
    category: 'interest',
    statement: 'bad',
    epistemic_type: 'observed_pattern',
    confidence: 'medium',
    relation_type: 'new',
    evidence: [{ source_kind: 'fabricated_kind', source_id: DAILY_A_LAB, evidence_role: 'supports' }],
  }, allowed, meta).ok,
  'arbitrary source_kind REJECT',
);
assert(intakeA === `${ASSESS_A}:${INTAKE_ITEM}`, 'intake source_id keeps assessmentUUID:itemId');

const step1Prompt = readFileSync('lib/member-qualitative-ai.js', 'utf8');
assert(step1Prompt.includes('定量アンケートの尺度スコアはまだ与えません'), 'STEP1 excludes psych scores');
assert(step1Prompt.includes('buildStep2Prompt'), 'STEP2 path present');

console.log(`\n--- 結果: ${passed} passed, ${failed} failed ---\n`);
if (failed) process.exit(1);
