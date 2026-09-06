#!/usr/bin/env node
/**
 * Phase 6B — consent_records canonical store + runtime gate
 */
import { readFileSync } from 'node:fs';
import {
  LOCAL_AI_ANALYSIS_PURPOSE,
  LOCAL_AI_ANALYSIS_POLICY_VERSION,
  CONSENT_TYPES,
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

console.log('\n=== Phase 6B: schema / migration ===\n');

const schema = readFileSync('db/schema.sql', 'utf8');
const mig = readFileSync('db/migrations/2026-09-member-local-ai-consent.sql', 'utf8');
const mig6a = readFileSync('db/migrations/2026-09-member-qualitative-intake-evidence.sql', 'utf8');

assert(schema.includes('CREATE TABLE IF NOT EXISTS consent_records'), 'schema has consent_records');
assert(mig.includes('CREATE TABLE IF NOT EXISTS consent_records'), 'migration has consent_records');
assert(mig.includes('REFERENCES students'), 'FK to students(id)');
assert(
  CONSENT_TYPES.every((t) => mig.includes(`'${t}'`)),
  'migration lists all consent types',
);
assert(mig.includes("status IN ('active', 'withdrawn')"), 'statuses active/withdrawn');
assert(mig.includes('idx_consent_records_student_type_active_unique'), 'active uniqueness index');
assert(mig.includes('status = \'active\' AND withdrawn_at IS NULL'), 'active ⇒ withdrawn_at NULL');
assert(mig.includes('status = \'withdrawn\' AND withdrawn_at IS NOT NULL'), 'withdrawn ⇒ withdrawn_at set');
assert(mig.includes('Phase 6A') && mig.includes('Phase 6B'), 'migration order documented in 6B');
assert(mig6a.includes('Phase 6B'), '6A migration notes 6B order');
assert(LOCAL_AI_ANALYSIS_POLICY_VERSION === 'local-ai-analysis-2026-v1', 'required policy version constant');

console.log('\n=== Phase 6B: evaluate lifecycle ===\n');

assert(!evaluateLocalAiAnalysisConsent(null).permitted, 'no row → denied');
assert(evaluateLocalAiAnalysisConsent(null).reason === 'consent_absent', 'no row → consent_absent');

assert(
  evaluateLocalAiAnalysisConsent({
    status: 'active',
    consent_type: LOCAL_AI_ANALYSIS_PURPOSE,
    policy_version: LOCAL_AI_ANALYSIS_POLICY_VERSION,
  }).permitted,
  'active local_ai_analysis → permitted',
);

assert(
  !evaluateLocalAiAnalysisConsent({
    status: 'active',
    consent_type: LOCAL_AI_ANALYSIS_PURPOSE,
    policy_version: 'local-ai-analysis-2025-v0',
  }).permitted
  && evaluateLocalAiAnalysisConsent({
    status: 'active',
    consent_type: LOCAL_AI_ANALYSIS_PURPOSE,
    policy_version: 'local-ai-analysis-2025-v0',
  }).reason === 'consent_policy_outdated',
  'active + old policy → consent_policy_outdated',
);


assert(
  !evaluateLocalAiAnalysisConsent({
    status: 'withdrawn',
    consent_type: LOCAL_AI_ANALYSIS_PURPOSE,
    policy_version: LOCAL_AI_ANALYSIS_POLICY_VERSION,
    withdrawn_at: '2026-01-02T00:00:00.000Z',
  }).permitted,
  'withdrawn → denied',
);

assert(
  !evaluateLocalAiAnalysisConsent({
    status: 'active',
    consent_type: 'operational_use',
    policy_version: LOCAL_AI_ANALYSIS_POLICY_VERSION,
  }).permitted,
  'other consent_type active only → local AI denied',
);

assert(
  !evaluateLocalAiAnalysisConsent({
    status: 'active',
    consent_type: LOCAL_AI_ANALYSIS_PURPOSE,
    policy_version: '  ',
  }).permitted,
  'active without policy_version → fail closed',
);

assert(
  !evaluateLocalAiAnalysisConsent({
    status: 'active',
    consent_type: LOCAL_AI_ANALYSIS_PURPOSE,
    policy_version: LOCAL_AI_ANALYSIS_POLICY_VERSION,
    withdrawn_at: '2026-01-02T00:00:00.000Z',
  }).permitted,
  'active + withdrawn_at inconsistent → consent_unknown',
);

assert(
  !evaluateLocalAiAnalysisConsent({ status: 'mystery', consent_type: LOCAL_AI_ANALYSIS_PURPOSE }).permitted,
  'malformed status → fail closed',
);

console.log('\n=== Phase 6B: in-memory episodes (history preserved) ===\n');

const store = createInMemoryConsentStore();
const sid = 'stu-consent-1';

assert(evaluateLocalAiAnalysisConsent(store.loadLocalAi(sid)).reason === 'consent_absent', 'store empty → absent');

const ep1 = store.record({
  studentId: sid,
  policyVersion: LOCAL_AI_ANALYSIS_POLICY_VERSION,
  consentedAt: '2026-01-01T00:00:00.000Z',
});
assert(ep1.status === 'active', 'episode1 active recorded');
assert(evaluateLocalAiAnalysisConsent(store.loadLocalAi(sid)).permitted, 'episode1 → permitted');

let dupBlocked = false;
try {
  store.record({
    studentId: sid,
    policyVersion: LOCAL_AI_ANALYSIS_POLICY_VERSION,
    consentedAt: '2026-01-02T00:00:00.000Z',
  });
} catch (e) {
  dupBlocked = e.code === 'active_consent_already_exists';
}
assert(dupBlocked, 'active ×2 same student+type → blocked');

store.withdraw({ studentId: sid, withdrawnAt: '2026-02-01T00:00:00.000Z' });
assert(store.rows.filter((r) => r.student_id === sid).length === 1, 'withdraw keeps history row');
assert(store.rows[0].status === 'withdrawn', 'episode1 withdrawn');
assert(
  evaluateLocalAiAnalysisConsent(store.loadLocalAi(sid)).reason === 'consent_withdrawn',
  'active→withdraw → denied withdrawn',
);

const ep2 = store.record({
  studentId: sid,
  policyVersion: LOCAL_AI_ANALYSIS_POLICY_VERSION,
  consentedAt: '2026-03-01T00:00:00.000Z',
});
assert(ep2.status === 'active', 're-consent episode2 active');
assert(store.rows.filter((r) => r.student_id === sid).length === 2, 'history has 2 episodes');
assert(evaluateLocalAiAnalysisConsent(store.loadLocalAi(sid)).permitted, 'withdrawn→new active → permitted');

console.log('\n=== Phase 6B: runtime gate (loader override, no Ollama) ===\n');

__testResetLocalAiConsentLoader();

{
  __testSetLocalAiConsentLoader(async () => null);
  const d = await resolveLocalAiAnalysisConsent(sid, { provider: 'local_worker' });
  assert(!d.permitted && d.reason === 'consent_absent', 'local_worker + absent → denied');
  let threw = false;
  try {
    await assertLocalAiAnalysisConsentOrThrow(sid, { provider: 'local_worker' });
  } catch (e) {
    threw = e.code === 'consent_absent' && e.status === 403;
  }
  assert(threw, 'assert enqueue gate throws on absent');
}

{
  __testSetLocalAiConsentLoader(async () => ({
    status: 'withdrawn',
    consent_type: LOCAL_AI_ANALYSIS_PURPOSE,
    policy_version: LOCAL_AI_ANALYSIS_POLICY_VERSION,
    withdrawn_at: '2026-02-01T00:00:00.000Z',
  }));
  const d = await resolveLocalAiAnalysisConsent(sid, { provider: 'local_worker' });
  assert(!d.permitted && d.reason === 'consent_withdrawn', 'local_worker + withdrawn → denied');
}

{
  __testSetLocalAiConsentLoader(async () => ({
    status: 'active',
    consent_type: LOCAL_AI_ANALYSIS_PURPOSE,
    policy_version: LOCAL_AI_ANALYSIS_POLICY_VERSION,
  }));
  const d = await resolveLocalAiAnalysisConsent(sid, { provider: 'local_worker' });
  assert(d.permitted, 'local_worker + active consent → enqueue permitted');
  await assertLocalAiAnalysisConsentOrThrow(sid, { provider: 'local_worker' });
  assert(true, 'assert passes with active consent');
}

{
  const mock = await resolveLocalAiAnalysisConsent(sid, { provider: 'mock' });
  assert(mock.permitted && mock.reason === 'mock_provider_exempt', 'mock provider still exempt');
}

__testResetLocalAiConsentLoader();

console.log('\n=== Phase 6B: Form separation ===\n');

const consentLib = readFileSync('lib/member-local-ai-consent.js', 'utf8');
assert(!/item_answers/.test(consentLib) || consentLib.includes('推測'), 'consent lib does not treat item_answers as grant');
assert(consentLib.includes('Form item_answers から同意を推測・自動生成しない'), 'explicit Form separation comment');

const api = readFileSync('api/psych-assessments.js', 'utf8');
assert(api.includes('consent-status') && api.includes('consent-record') && api.includes('consent-withdraw'), 'API actions present');
assert(api.includes("source: 'admin_recorded'"), 'record forces admin_recorded');
assert(!api.includes("api/consent"), 'no new consent function entrypoint');

console.log(`\n--- 結果: ${passed} passed, ${failed} failed ---\n`);
if (failed) process.exit(1);
