#!/usr/bin/env node
/**
 * Phase 6D — required Local AI policy_version enforcement
 */
import { readFileSync } from 'node:fs';
import {
  LOCAL_AI_ANALYSIS_PURPOSE,
  LOCAL_AI_ANALYSIS_POLICY_VERSION,
  getRequiredLocalAiAnalysisPolicyVersion,
  evaluateLocalAiAnalysisConsent,
  resolveLocalAiAnalysisConsent,
  assertLocalAiAnalysisConsentOrThrow,
  createInMemoryConsentStore,
  __testSetLocalAiConsentLoader,
  __testResetLocalAiConsentLoader,
} from '../lib/member-local-ai-consent.js';

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

console.log('\n=== Phase 6D: constant ===\n');
assert(LOCAL_AI_ANALYSIS_POLICY_VERSION === 'local-ai-analysis-2026-v1', 'formal version string');
assert(getRequiredLocalAiAnalysisPolicyVersion() === LOCAL_AI_ANALYSIS_POLICY_VERSION, 'getter matches constant');
const consentLib = readFileSync('lib/member-local-ai-consent.js', 'utf8');
assert((consentLib.match(/local-ai-analysis-2026-v1/g) || []).length >= 1, 'version defined in consent lib');
const docs = readFileSync('docs/member-analysis-local-worker.md', 'utf8');
assert(docs.includes('local-ai-analysis-2026-v1'), 'docs references required policy version');

console.log('\n=== Phase 6D: evaluate ===\n');

assert(
  evaluateLocalAiAnalysisConsent({
    status: 'active',
    consent_type: LOCAL_AI_ANALYSIS_PURPOSE,
    policy_version: LOCAL_AI_ANALYSIS_POLICY_VERSION,
  }).permitted,
  'active + required policy → permitted',
);

assert(
  evaluateLocalAiAnalysisConsent({
    status: 'active',
    consent_type: LOCAL_AI_ANALYSIS_PURPOSE,
    policy_version: 'local-ai-analysis-2025-v0',
  }).reason === 'consent_policy_outdated',
  'active + old policy → denied outdated',
);

assert(
  evaluateLocalAiAnalysisConsent({
    status: 'active',
    consent_type: LOCAL_AI_ANALYSIS_PURPOSE,
    policy_version: 'arbitrary-policy',
  }).reason === 'consent_policy_outdated',
  'active + arbitrary policy → denied',
);

assert(evaluateLocalAiAnalysisConsent(null).reason === 'consent_absent', 'missing → denied');

assert(
  evaluateLocalAiAnalysisConsent({
    status: 'withdrawn',
    consent_type: LOCAL_AI_ANALYSIS_PURPOSE,
    policy_version: LOCAL_AI_ANALYSIS_POLICY_VERSION,
    withdrawn_at: '2026-02-01T00:00:00.000Z',
  }).reason === 'consent_withdrawn',
  'withdrawn + required → denied',
);

console.log('\n=== Phase 6D: re-consent lifecycle ===\n');
const store = createInMemoryConsentStore();
const sid = 'stu-6d';

let oldBlocked = false;
try {
  store.record({
    studentId: sid,
    policyVersion: 'local-ai-analysis-2025-v0',
    consentedAt: '2026-01-01T00:00:00.000Z',
  });
} catch (e) {
  oldBlocked = e.code === 'consent_policy_version_mismatch';
}
assert(oldBlocked, 'record rejects old policy for local_ai_analysis');

store.record({
  studentId: sid,
  policyVersion: LOCAL_AI_ANALYSIS_POLICY_VERSION,
  consentedAt: '2026-01-01T00:00:00.000Z',
});
assert(evaluateLocalAiAnalysisConsent(store.loadLocalAi(sid)).permitted, 'current version recorded → permitted');

store.withdraw({ studentId: sid });
assert(evaluateLocalAiAnalysisConsent(store.loadLocalAi(sid)).reason === 'consent_withdrawn', 'withdraw → denied');

store.record({
  studentId: sid,
  policyVersion: LOCAL_AI_ANALYSIS_POLICY_VERSION,
  consentedAt: '2026-03-01T00:00:00.000Z',
});
assert(evaluateLocalAiAnalysisConsent(store.loadLocalAi(sid)).permitted, 're-consent with current version → permitted');
assert(store.rows.filter((r) => r.student_id === sid).length === 2, 'history preserved (2 episodes)');

console.log('\n=== Phase 6D: runtime gate (loader override) ===\n');
__testResetLocalAiConsentLoader();

{
  __testSetLocalAiConsentLoader(async () => ({
    status: 'active',
    consent_type: LOCAL_AI_ANALYSIS_PURPOSE,
    policy_version: 'local-ai-analysis-2025-v0',
  }));
  const d = await resolveLocalAiAnalysisConsent(sid, { provider: 'local_worker' });
  assert(d.reason === 'consent_policy_outdated', 'local_worker enqueue requires current version');
  let threw = false;
  try {
    await assertLocalAiAnalysisConsentOrThrow(sid, { provider: 'local_worker' });
  } catch (e) {
    threw = e.code === 'consent_policy_outdated' && e.status === 403;
  }
  assert(threw, 'claim/enqueue defense throws consent_policy_outdated');
}

{
  __testSetLocalAiConsentLoader(async () => ({
    status: 'active',
    consent_type: LOCAL_AI_ANALYSIS_PURPOSE,
    policy_version: LOCAL_AI_ANALYSIS_POLICY_VERSION,
  }));
  await assertLocalAiAnalysisConsentOrThrow(sid, { provider: 'local_worker' });
  assert(true, 'local_worker + required version → permitted');
}

{
  const mock = await resolveLocalAiAnalysisConsent(sid, { provider: 'mock' });
  assert(mock.permitted && mock.reason === 'mock_provider_exempt', 'mock still exempt');
}

__testResetLocalAiConsentLoader();

console.log(`\n--- 結果: ${passed} passed, ${failed} failed ---\n`);
if (failed) process.exit(1);
