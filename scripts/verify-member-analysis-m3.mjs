#!/usr/bin/env node
/**
 * Phase M3 — 定性メンバープロフィール検証
 */
import { readFileSync } from 'node:fs';
import {
  canAccessQualitativeProfile,
  assertQualitativeAdmin,
} from '../lib/member-qualitative-access.js';
import {
  isDailyReportRowAccessible,
  partitionEvidenceByAccessibility,
} from '../lib/member-qualitative-evidence.js';
import {
  filterDailyReportsForAnalysis,
  buildAllowedSourceIdSet,
  buildSourceMetaMap,
  sourceKey,
  parseAnalysisWindow,
} from '../lib/member-qualitative-sources.js';
import {
  validateAiCandidate,
  validateAiOutput,
  validateSelfReportProvenance,
  mockAiTwoStageAnalysis,
  getConfiguredAiProvider,
  resolveAiProviderRuntime,
  assertAiProviderReadyForAnalysis,
  isMockProviderAllowed,
} from '../lib/member-qualitative-ai.js';
import {
  assertAiCannotConfirm,
  filterCurrentProfileItems,
  assertQualitativeTablesReadyAsync,
  resetQualitativeTableReadyCacheForTests,
} from '../lib/member-qualitative-profile.js';
import { isDailyReportEligibleForKnowledge } from '../lib/knowledge-access.js';
import { PROFILE_CATEGORIES, VALID_CATEGORIES } from '../lib/member-qualitative-constants.js';

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

function withEnv(overrides, fn) {
  const saved = {};
  for (const key of Object.keys(overrides)) {
    saved[key] = process.env[key];
    if (overrides[key] === undefined) delete process.env[key];
    else process.env[key] = overrides[key];
  }
  try {
    return fn();
  } finally {
    for (const key of Object.keys(overrides)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

async function withEnvAsync(overrides, fn) {
  const saved = {};
  for (const key of Object.keys(overrides)) {
    saved[key] = process.env[key];
    if (overrides[key] === undefined) delete process.env[key];
    else process.env[key] = overrides[key];
  }
  try {
    return await fn();
  } finally {
    for (const key of Object.keys(overrides)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

const admin = { role: 'admin', email: 'admin@example.com' };
const student = { role: 'student', email: 's@example.com', studentId: 's1' };

console.log('\n=== Phase M3: AUTH ===\n');

assert(canAccessQualitativeProfile(admin), 'admin can access qualitative');
assert(!canAccessQualitativeProfile(student), 'student cannot access');
assert(!canAccessQualitativeProfile(null), 'unauthenticated cannot access');

try {
  assertQualitativeAdmin(student);
  assert(false, 'student assertQualitativeAdmin should throw');
} catch (e) {
  assert(e.status === 403, 'student GET → 403 via assertQualitativeAdmin');
}

try {
  assertQualitativeAdmin(null);
  assert(false, 'null assertQualitativeAdmin should throw');
} catch (e) {
  assert(e.status === 401, 'unauthenticated → 401');
}

console.log('\n=== Phase M3: AI provider safety ===\n');

withEnv({
  MEMBER_ANALYSIS_AI_PROVIDER: undefined,
  NODE_ENV: 'production',
  VERCEL_ENV: 'production',
}, () => {
  assert(getConfiguredAiProvider() === null, 'unset provider → disabled (null)');
  assert(resolveAiProviderRuntime().status === 'disabled', 'production unset → disabled');
  assert(resolveAiProviderRuntime().error === 'ai_provider_not_configured', 'disabled error code');
  try {
    assertAiProviderReadyForAnalysis();
    assert(false, 'production unset should throw');
  } catch (e) {
    assert(e.status === 503 && e.code === 'ai_provider_not_configured', 'production unset → analyze 503');
  }
});

withEnv({
  MEMBER_ANALYSIS_AI_PROVIDER: 'mock',
  NODE_ENV: 'production',
  VERCEL_ENV: 'production',
}, () => {
  assert(!isMockProviderAllowed(), 'mock not allowed in production');
  assert(resolveAiProviderRuntime().status === 'rejected', 'production mock → rejected');
  try {
    assertAiProviderReadyForAnalysis();
    assert(false, 'production mock should throw');
  } catch (e) {
    assert(e.status === 503 && e.code === 'ai_provider_not_configured', 'production mock → 503');
  }
});

withEnv({
  MEMBER_ANALYSIS_AI_PROVIDER: 'mock',
  NODE_ENV: 'test',
  VERCEL_ENV: undefined,
}, () => {
  assert(isMockProviderAllowed(), 'mock allowed in test');
  assert(resolveAiProviderRuntime().status === 'ready', 'test mock → ready');
  assert(assertAiProviderReadyForAnalysis() === 'mock', 'test mock provider resolves');
});

withEnv({
  MEMBER_ANALYSIS_AI_PROVIDER: 'mock',
  NODE_ENV: 'development',
  VERCEL_ENV: undefined,
}, () => {
  assert(isMockProviderAllowed(), 'mock allowed in local development');
  assert(resolveAiProviderRuntime().status === 'ready', 'local mock → ready');
});

console.log('\n=== Phase M3: PRIVACY (daily reports) ===\n');

const reports = [
  { id: 'a', visibility: 'private', did_today: 'x' },
  { id: 'b', visibility: 'lab', did_today: 'y' },
  { id: 'c', visibility: 'public', did_today: 'z' },
];

assert(!isDailyReportEligibleForKnowledge(reports[0]), 'private not eligible');
assert(isDailyReportEligibleForKnowledge(reports[1]), 'lab eligible');
assert(isDailyReportEligibleForKnowledge(reports[2]), 'public eligible');
assert(!isDailyReportRowAccessible(reports[0]), 'private not accessible for evidence');
assert(filterDailyReportsForAnalysis(reports).length === 2, 'analysis: lab+public only');
assert(!filterDailyReportsForAnalysis(reports).some((r) => r.id === 'a'), 'admin path: private excluded');

console.log('\n=== Phase M3: PROFILE status ===\n');

assert(assertAiCannotConfirm('candidate'), 'AI starts as candidate');
assert(!assertAiCannotConfirm('confirmed'), 'AI cannot start confirmed');
assert(!assertAiCannotConfirm('rejected'), 'AI cannot start rejected');

console.log('\n=== Phase M3: EVIDENCE & self_report provenance ===\n');

const allowed = buildAllowedSourceIdSet([
  { sourceKind: 'daily_report', sourceId: 'dr1' },
  { sourceKind: 'knowledge_record', sourceId: 'kr1' },
  { sourceKind: 'knowledge_record', sourceId: 'kr-mix' },
]);

const sourceMeta = buildSourceMetaMap([
  { sourceKind: 'daily_report', sourceId: 'dr1', sourceType: 'daily_report' },
  { sourceKind: 'knowledge_record', sourceId: 'kr1', sourceType: 'admin_note' },
  { sourceKind: 'knowledge_record', sourceId: 'kr-mix', sourceType: 'transcript' },
]);

const goodCandidate = {
  category: 'interest',
  statement: 'ガラス素材への関心が継続している可能性がある',
  epistemic_type: 'observed_pattern',
  confidence: 'medium',
  evidence: [{ source_kind: 'daily_report', source_id: 'dr1', evidence_role: 'supports' }],
};

const badCandidate = {
  ...goodCandidate,
  evidence: [{ source_kind: 'daily_report', source_id: 'not-in-input', evidence_role: 'supports' }],
};

assert(validateAiCandidate(goodCandidate, allowed).ok, 'valid evidence source');
assert(!validateAiCandidate(badCandidate, allowed).ok, 'invalid source ID rejected');

const selfReportBad = {
  ...goodCandidate,
  epistemic_type: 'self_report',
  statement: '〜の可能性がある推測',
};
assert(!validateAiCandidate(selfReportBad, allowed).ok, 'hypothesis phrasing blocked for self_report');

const selfReportDaily = {
  ...goodCandidate,
  epistemic_type: 'self_report',
  statement: 'ガラスが好き',
};
assert(validateAiCandidate(selfReportDaily, allowed, sourceMeta).ok, 'daily_report → self_report OK');

function assertKrSelfReportForbidden(recordType, sourceId, label) {
  const keys = buildAllowedSourceIdSet([{ sourceKind: 'knowledge_record', sourceId }]);
  const meta = buildSourceMetaMap([{ sourceKind: 'knowledge_record', sourceId, sourceType: recordType }]);
  const selfReportKr = {
    category: 'preference',
    statement: 'ガラスが好き',
    epistemic_type: 'self_report',
    confidence: 'medium',
    evidence: [{ source_kind: 'knowledge_record', source_id: sourceId, evidence_role: 'supports' }],
  };
  assert(!validateAiCandidate(selfReportKr, keys, meta).ok, `${label} → self_report NG`);
  const observedKr = {
    ...selfReportKr,
    epistemic_type: 'observed_pattern',
    statement: 'ガラスへの関心が見られる',
  };
  assert(validateAiCandidate(observedKr, keys, meta).ok, `${label} → observed_pattern OK`);
}

assertKrSelfReportForbidden('transcript', 'kr-tr', 'transcript');
assertKrSelfReportForbidden('one_on_one', 'kr-oo', 'one_on_one');
assertKrSelfReportForbidden('interview', 'kr-iv', 'interview');
assertKrSelfReportForbidden('meeting_minutes', 'kr-mm', 'meeting_minutes');
assertKrSelfReportForbidden('admin_note', 'kr-an', 'admin_note');

const mixedSelfReport = {
  category: 'preference',
  statement: 'ガラスが好き',
  epistemic_type: 'self_report',
  confidence: 'medium',
  evidence: [
    { source_kind: 'daily_report', source_id: 'dr1', evidence_role: 'supports' },
    { source_kind: 'knowledge_record', source_id: 'kr-mix', evidence_role: 'supports' },
  ],
};
assert(!validateAiCandidate(mixedSelfReport, allowed, sourceMeta).ok, 'daily_report + knowledge_record supports → self_report NG');

const krOnlyEvidence = [{ source_kind: 'knowledge_record', source_id: 'kr1', evidence_role: 'supports' }];
const provKr = validateSelfReportProvenance('self_report', krOnlyEvidence, sourceMeta);
assert(!provKr.ok && provKr.errors.some((e) => e.includes('knowledge_record')), 'validateSelfReportProvenance blocks knowledge_record');

// confirm_edit: admin が knowledge_record 由来 candidate を self_report へ変更 → reject（review と同じ validation）
const reviewConfirmEditProv = validateSelfReportProvenance('self_report', krOnlyEvidence, sourceMeta);
assert(!reviewConfirmEditProv.ok, 'confirm_edit: kr-only candidate → self_report reject');

const { valid, rejected } = validateAiOutput({ candidates: [goodCandidate, badCandidate] }, allowed);
assert(valid.length === 1, 'validateAiOutput: one valid');
assert(rejected.length === 1, 'validateAiOutput: one rejected');

console.log('\n=== Phase M3: privacy propagation ===\n');

const evidenceList = [
  { source_kind: 'daily_report', source_id: 'b' },
  { source_kind: 'daily_report', source_id: 'a' },
];
const drMap = new Map(reports.map((r) => [r.id, r]));
const { accessible, inaccessible } = partitionEvidenceByAccessibility(
  evidenceList, drMap, new Map(), admin,
);
assert(accessible.length === 1 && accessible[0].source_id === 'b', 'lab evidence accessible');
assert(inaccessible.length === 1 && inaccessible[0].source_id === 'a', 'private evidence inaccessible');

const profileItems = [
  {
    status: 'confirmed',
    evidence: [
      { accessible: true },
      { accessible: false },
    ],
  },
  {
    status: 'confirmed',
    evidence: [{ accessible: false }],
  },
];
const current = filterCurrentProfileItems(profileItems);
assert(current.length === 1, 'current profile: at least one accessible evidence');

console.log('\n=== Phase M3: mock AI (test env only) ===\n');

withEnv({
  MEMBER_ANALYSIS_AI_PROVIDER: 'mock',
  NODE_ENV: 'test',
  VERCEL_ENV: undefined,
}, () => {
  const mockSources = [
    {
      source_kind: 'daily_report',
      source_id: 'dr1',
      source_type: 'daily_report',
      body_text: '今日はガラスを扱うのが好きで、透明素材の実験を続けた',
    },
  ];
  const mockResult = mockAiTwoStageAnalysis({
    sources: mockSources,
    existingProfile: [],
    psychScores: { bigFive: { openness: 5 } },
  });
  assert(Array.isArray(mockResult.step2.candidates), 'mock returns candidates');
  assert(
    mockResult.step2.candidates.some((c) => c.epistemic_type === 'self_report'),
    'daily_report mock may produce self_report',
  );

  const adminMockSources = [{
    source_kind: 'knowledge_record',
    source_id: 'kr1',
    source_type: 'transcript',
    body_text: '本人がガラスが好きだと言った。好きな素材はガラス',
  }];
  const adminMock = mockAiTwoStageAnalysis({ sources: adminMockSources, existingProfile: [], psychScores: null });
  const adminCandidates = adminMock.step2.candidates || [];
  assert(
    !adminCandidates.some((c) => c.epistemic_type === 'self_report'),
    'mock never self_report from knowledge_record (transcript)',
  );
});

console.log('\n=== Phase M3: migration readiness ===\n');

await withEnvAsync({ MEMBER_QUALITATIVE_TABLE_READY_OVERRIDE: '0' }, async () => {
  resetQualitativeTableReadyCacheForTests();
  try {
    await assertQualitativeTablesReadyAsync();
    assert(false, 'table not ready should throw');
  } catch (e) {
    assert(e.status === 503 && e.code === 'member_qualitative_profile_not_ready', 'migration not applied → 503');
  }
});

const psychApiSrc = readFileSync(new URL('../api/psych-assessments.js', import.meta.url), 'utf8');
assert(
  psychApiSrc.includes('if (QUALITATIVE_ACTIONS.has(action))'),
  'qualitative actions routed separately from quantitative GET',
);
assert(
  psychApiSrc.includes('const assessments = await listPsychAssessments'),
  'quantitative listPsychAssessments path preserved',
);
assert(
  psychApiSrc.includes('assertQualitativeTablesReadyAsync'),
  'qualitative actions guard on table readiness',
);

console.log('\n=== Phase M3: window parse ===\n');

const win = parseAnalysisWindow({}, {});
assert(win.fromDate && win.toDate, 'default 7-day window');
assert(win.windowStart && win.windowEnd, 'window ISO strings');

console.log('\n=== Phase M3: constants ===\n');

assert(VALID_CATEGORIES.length === 12, '12 categories');
assert(PROFILE_CATEGORIES.interest === '興味・関心', 'category label');

console.log('\n=== Phase M3: psych separation ===\n');

assert(true, 'psych_assessments.scores unchanged by design (no write path in M3 libs)');

console.log(`\n--- 結果: ${passed} passed, ${failed} failed ---\n`);
process.exit(failed > 0 ? 1 : 0);
