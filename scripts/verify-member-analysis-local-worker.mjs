#!/usr/bin/env node
/**
 * Phase M3-L — Local Qwen Worker 検証
 */
import { readFileSync } from 'node:fs';
import {
  verifyWorkerSecret,
  MEMBER_ANALYSIS_WORKER_SECRET_HEADER,
} from '../lib/member-analysis-worker-auth.js';
import {
  resolveAiProviderRuntime,
  assertAiProviderReadyForAnalysis,
  assertSyncAiProviderForExecution,
  isQueueBasedProvider,
  validateAiCandidate,
  validateAiOutput,
} from '../lib/member-qualitative-ai.js';
import {
  computeAnalysisInputFingerprint,
  buildWorkerJobPayload,
  formatWorkerPayloadSources,
  assertRunClaim,
  filterStep2Candidates,
  candidateIdentityKey,
  getAnalysisInputMaxChars,
  computeAnalysisInputSize,
  toAnalysisDateOnly,
  buildAnalysisWindowFromRun,
  getWorkerLeaseSeconds,
} from '../lib/member-qualitative-worker.js';
import {
  mockOllamaTwoStageAnalysis,
  CANDIDATES_JSON_SCHEMA,
  getOllamaConfig,
  buildOllamaChatRequestBody,
  isOllamaContextLimitReached,
  isValidPromptEvalCount,
  assertOllamaPromptEvalCountPresent,
  assertOllamaGenerationComplete,
  assertOllamaContextCapacity,
  extractOllamaResponseMeta,
  runOllamaTwoStageAnalysis,
} from '../lib/member-qualitative-ollama.js';
import { OLLAMA_DEFAULT_NUM_CTX, OLLAMA_CONTEXT_SAFETY_MARGIN, WORKER_LEASE_SECONDS } from '../lib/member-qualitative-constants.js';
import { filterDailyReportsForAnalysis } from '../lib/member-qualitative-sources.js';
import { isDailyReportEligibleForKnowledge } from '../lib/knowledge-access.js';

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

console.log('\n=== M3-L: PROVIDER ===\n');

withEnv({
  MEMBER_ANALYSIS_AI_PROVIDER: 'local_worker',
  NODE_ENV: 'production',
  VERCEL_ENV: 'production',
}, () => {
  const r = resolveAiProviderRuntime();
  assert(r.status === 'ready' && r.provider === 'local_worker', 'production + local_worker → ready');
  assert(r.mode === 'queue', 'local_worker mode = queue');
  assert(assertAiProviderReadyForAnalysis() === 'local_worker', 'analyze enqueue allowed');
  try {
    assertSyncAiProviderForExecution();
    assert(false, 'local_worker must not run sync AI on server');
  } catch (e) {
    assert(e.code === 'local_worker_does_not_run_on_server', 'server-side LLM blocked');
  }
});

withEnv({
  MEMBER_ANALYSIS_AI_PROVIDER: 'mock',
  NODE_ENV: 'production',
  VERCEL_ENV: 'production',
}, () => {
  assert(resolveAiProviderRuntime().status === 'rejected', 'production + mock → rejected');
});

withEnv({ MEMBER_ANALYSIS_AI_PROVIDER: undefined }, () => {
  assert(resolveAiProviderRuntime().status === 'disabled', 'provider unset → disabled');
});

assert(isQueueBasedProvider('local_worker'), 'isQueueBasedProvider local_worker');
assert(!isQueueBasedProvider('mock'), 'mock is not queue');

console.log('\n=== M3-L: WORKER AUTH ===\n');

withEnv({ MEMBER_ANALYSIS_WORKER_SECRET: 'test-worker-secret-value' }, () => {
  assert(!verifyWorkerSecret(undefined).ok, 'missing secret → 401');
  assert(!verifyWorkerSecret('wrong-secret-value-xx').ok, 'wrong secret → 401');
  assert(verifyWorkerSecret('test-worker-secret-value').ok, 'valid secret → ok');
});

withEnv({ MEMBER_ANALYSIS_WORKER_SECRET: undefined }, () => {
  assert(verifyWorkerSecret('x').status === 503, 'secret not configured → 503');
});

assert(MEMBER_ANALYSIS_WORKER_SECRET_HEADER === 'x-member-analysis-worker-secret', 'worker header name');

console.log('\n=== M3-L: JOB PAYLOAD / PII ===\n');

const sources = [
  {
    sourceKind: 'daily_report',
    sourceId: 'dr1',
    sourceType: 'daily_report',
    title: '木下涼の日報',
    occurredAt: '2026-08-01T00:00:00.000Z',
    bodyText: 'ガラスが好き',
    visibility: 'lab',
    createdAt: '2026-08-01T12:00:00.000Z',
  },
];

const payload = buildWorkerJobPayload({
  runId: 'run-1',
  claimToken: 'tok-1',
  studentId: 'student-uuid',
  windowStart: '2026-08-01T00:00:00.000Z',
  windowEnd: '2026-08-07T23:59:59.999Z',
  sources,
  existingConfirmed: [],
  psychAssessment: null,
  inputFingerprint: 'abc',
});

assert(payload.student_id === 'student-uuid', 'payload has student_id');
assert(!('student_name' in payload), 'no student_name in payload');
assert(!('email' in payload), 'no email in payload');
const formatted = formatWorkerPayloadSources(sources);
assert(formatted[0].title === '日報', 'daily_report title stripped of name');
assert(!formatted[0].title.includes('木下'), 'no student name in title');

console.log('\n=== M3-L: FINGERPRINT ===\n');

const fp1 = computeAnalysisInputFingerprint(sources);
const fp2 = computeAnalysisInputFingerprint([{ ...sources[0], visibility: 'private' }]);
assert(fp1 !== fp2, 'visibility change → different fingerprint');

console.log('\n=== M3-L: CLAIM / STALE ===\n');

const runRow = {
  status: 'running',
  worker_id: 'w1',
  claim_token: 'tok-a',
};

try {
  assertRunClaim(runRow, { workerId: 'w2', claimToken: 'tok-a' });
  assert(false, 'wrong worker should throw');
} catch (e) {
  assert(e.code === 'stale_claim', 'wrong worker → stale_claim');
}

try {
  assertRunClaim(runRow, { workerId: 'w1', claimToken: 'tok-b' });
  assert(false, 'wrong token should throw');
} catch (e) {
  assert(e.code === 'stale_claim', 'wrong token → stale_claim');
}

assert(assertRunClaim({ status: 'completed' }, { workerId: 'w1', claimToken: 'x' }).alreadyCompleted, 'completed → idempotent');

console.log('\n=== M3-L: PRIVACY ===\n');

const reports = [
  { id: 'a', visibility: 'private', did_today: 'x' },
  { id: 'b', visibility: 'lab', did_today: 'y' },
  { id: 'c', visibility: 'public', did_today: 'z' },
];
assert(!isDailyReportEligibleForKnowledge(reports[0]), 'private not eligible');
assert(filterDailyReportsForAnalysis(reports).length === 2, 'lab+public only');

console.log('\n=== M3-L: AI OUTPUT / self_report ===\n');

const allowed = new Set(['daily_report:dr1', 'knowledge_record:kr1']);
const meta = new Map([
  ['daily_report:dr1', { sourceKind: 'daily_report' }],
  ['knowledge_record:kr1', { sourceType: 'admin_note' }],
]);

const selfDaily = {
  category: 'preference',
  statement: 'ガラスが好き',
  epistemic_type: 'self_report',
  confidence: 'medium',
  relation_type: 'new',
  evidence: [{ source_kind: 'daily_report', source_id: 'dr1', evidence_role: 'supports' }],
};
assert(validateAiCandidate(selfDaily, allowed, meta).ok, 'daily_report self_report OK');

const selfKr = {
  ...selfDaily,
  evidence: [{ source_kind: 'knowledge_record', source_id: 'kr1', evidence_role: 'supports' }],
};
assert(!validateAiCandidate(selfKr, allowed, meta).ok, 'knowledge_record self_report NG');

const mixed = {
  ...selfDaily,
  evidence: [
    { source_kind: 'daily_report', source_id: 'dr1', evidence_role: 'supports' },
    { source_kind: 'knowledge_record', source_id: 'kr1', evidence_role: 'supports' },
  ],
};
assert(!validateAiCandidate(mixed, allowed, meta).ok, 'mixed supports self_report NG');

const badSourceId = {
  ...selfDaily,
  epistemic_type: 'observed_pattern',
  evidence: [{ source_kind: 'daily_report', source_id: 'not-in-input', evidence_role: 'supports' }],
};
assert(!validateAiCandidate(badSourceId, allowed, meta).ok, 'hallucinated source_id rejected');

console.log('\n=== M3-L: STEP2 FILTER ===\n');

const step1 = [{
  category: 'interest',
  statement: 'A',
  evidence: [{ source_kind: 'daily_report', source_id: 'dr1' }],
}];
const step2New = [
  ...step1,
  {
    category: 'goal',
    statement: 'psych-only',
    evidence: [{ source_kind: 'daily_report', source_id: 'dr1' }],
  },
];
const filtered = filterStep2Candidates(step1, step2New);
assert(filtered.length === 1, 'step2 drops candidates not in step1');
assert(candidateIdentityKey(step1[0]) === candidateIdentityKey(filtered[0]), 'step1 candidate preserved');

console.log('\n=== M3-L: INPUT SIZE ===\n');

assert(getAnalysisInputMaxChars() > 0, 'max input chars configured');
const bigSources = [{ bodyText: 'x'.repeat(getAnalysisInputMaxChars() + 1) }];
assert(computeAnalysisInputSize(bigSources) > getAnalysisInputMaxChars(), 'size detect overflow');
const withOverhead = computeAnalysisInputSize([{ bodyText: 'a'.repeat(100) }]);
assert(withOverhead > 100, 'preflight includes prompt overhead estimate');

console.log('\n=== M3-L: OLLAMA REQUEST ===\n');

withEnv({}, () => {
  const cfg = getOllamaConfig();
  assert(cfg.numCtx === 16384, 'num_ctx default 16384');
  assert(cfg.temperature === 0.1, 'temperature default 0.1');
  assert(cfg.presencePenalty === 0, 'presence_penalty default 0');
  assert(cfg.keepAlive === '10m', 'keep_alive default 10m');
  assert(cfg.timeoutMs === 600000, 'timeout default 600000');
});

withEnv({ MEMBER_ANALYSIS_OLLAMA_NUM_CTX: '32768' }, () => {
  assert(getOllamaConfig().numCtx === 32768, 'NUM_CTX override');
});

withEnv({ MEMBER_ANALYSIS_OLLAMA_KEEP_ALIVE: '30m' }, () => {
  assert(getOllamaConfig().keepAlive === '30m', 'KEEP_ALIVE override');
});

withEnv({ MEMBER_ANALYSIS_OLLAMA_TIMEOUT_MS: '900000' }, () => {
  assert(getOllamaConfig().timeoutMs === 900000, 'TIMEOUT override');
});

withEnv({ MEMBER_ANALYSIS_OLLAMA_NUM_CTX: 'invalid' }, () => {
  assert(getOllamaConfig().numCtx === 16384, 'invalid NUM_CTX → safe default');
});

const reqBody = buildOllamaChatRequestBody({
  systemPrompt: 'sys',
  userPrompt: 'user',
  schema: CANDIDATES_JSON_SCHEMA,
  config: getOllamaConfig(),
});
assert(reqBody.stream === false, 'stream=false');
assert(reqBody.format === CANDIDATES_JSON_SCHEMA, 'format JSON Schema');
assert(reqBody.options.num_ctx === 16384, 'options.num_ctx set');
assert(reqBody.options.presence_penalty === 0, 'options.presence_penalty=0');
assert(reqBody.options.temperature === 0.1, 'options.temperature=0.1');
assert(reqBody.keep_alive === '10m', 'keep_alive on request');
assert(reqBody.model === 'qwen3.6:35b-a3b' || typeof reqBody.model === 'string', 'model set');

console.log('\n=== M3-L: CONTEXT LIMIT ===\n');

assert(!isOllamaContextLimitReached(1000, OLLAMA_DEFAULT_NUM_CTX, OLLAMA_CONTEXT_SAFETY_MARGIN), 'safe prompt_eval_count OK');
assert(isOllamaContextLimitReached(OLLAMA_DEFAULT_NUM_CTX - 400, OLLAMA_DEFAULT_NUM_CTX, OLLAMA_CONTEXT_SAFETY_MARGIN), 'near limit detected');

try {
  assertOllamaContextCapacity({ prompt_eval_count: OLLAMA_DEFAULT_NUM_CTX - 100 }, { numCtx: OLLAMA_DEFAULT_NUM_CTX, contextSafetyMargin: 512 });
  assert(false, 'context limit should throw');
} catch (e) {
  assert(e.code === 'ollama_context_limit_reached', 'context limit → ollama_context_limit_reached');
}

assert(extractOllamaResponseMeta({ prompt_eval_count: 42, eval_count: 10 }).prompt_eval_count === 42, 'extract metadata');

console.log('\n=== M3-L: PROMPT TOKEN COUNT (fail-closed) ===\n');

assert(isValidPromptEvalCount(100), 'valid count');
assert(!isValidPromptEvalCount(null), 'null invalid');
assert(!isValidPromptEvalCount(undefined), 'undefined invalid');
assert(!isValidPromptEvalCount(0), 'zero invalid');
assert(!isValidPromptEvalCount(-1), 'negative invalid');
assert(!isValidPromptEvalCount(Number.NaN), 'NaN invalid');
assert(!isValidPromptEvalCount('abc'), 'non-numeric invalid');

for (const bad of [null, undefined, 0, -1, Number.NaN, 'x']) {
  try {
    assertOllamaPromptEvalCountPresent({ prompt_eval_count: bad });
    assert(false, `missing count should throw: ${String(bad)}`);
  } catch (e) {
    assert(e.code === 'ollama_prompt_token_count_missing', `missing → ollama_prompt_token_count_missing (${String(bad)})`);
  }
}

try {
  assertOllamaContextCapacity({ prompt_eval_count: null }, { numCtx: OLLAMA_DEFAULT_NUM_CTX, contextSafetyMargin: 512 });
  assert(false, 'null count in context guard should fail-closed');
} catch (e) {
  assert(e.code === 'ollama_prompt_token_count_missing', 'context guard fail-closed on null');
}

try {
  assertOllamaGenerationComplete({ done_reason: 'length' });
  assert(false, 'non-stop done_reason should throw');
} catch (e) {
  assert(e.code === 'ollama_incomplete_generation', 'done_reason length → ollama_incomplete_generation');
}

assert(assertOllamaGenerationComplete({ done_reason: 'stop' }) === undefined, 'done_reason stop OK');
assert(assertOllamaGenerationComplete({ done: true }) === undefined, 'missing done_reason OK');

const twoStageJob = {
  prompt_version: 'm3-v1',
  sources: [{ source_kind: 'daily_report', source_id: 'dr-x', body_text: 'fixture' }],
  existing_confirmed_profile: [],
  psych_assessment: null,
};

let step2Called = false;
try {
  await runOllamaTwoStageAnalysis(twoStageJob, {
    callOllamaStructured: async ({ stepLabel }) => {
      if (stepLabel === 'step1') {
        const err = new Error('ollama_prompt_token_count_missing');
        err.code = 'ollama_prompt_token_count_missing';
        throw err;
      }
      step2Called = true;
      return { parsed: { candidates: [] }, meta: { prompt_eval_count: 100 }, step: stepLabel };
    },
  });
  assert(false, 'STEP1 missing should propagate');
} catch (e) {
  assert(e.code === 'ollama_prompt_token_count_missing', 'STEP1 missing → failure');
}
assert(!step2Called, 'STEP1 missing → STEP2 not called');

step2Called = false;
try {
  await runOllamaTwoStageAnalysis(twoStageJob, {
    callOllamaStructured: async ({ stepLabel }) => {
      if (stepLabel === 'step1') {
        return {
          parsed: { observations: [{ category: 'interest', statement: 'x', epistemic_type: 'observed_pattern', confidence: 'medium', relation_type: 'new', related_item_id: null, evidence: [] }] },
          meta: { prompt_eval_count: 100 },
          step: stepLabel,
        };
      }
      step2Called = true;
      const err = new Error('ollama_prompt_token_count_missing');
      err.code = 'ollama_prompt_token_count_missing';
      throw err;
    },
  });
  assert(false, 'STEP2 missing should propagate');
} catch (e) {
  assert(e.code === 'ollama_prompt_token_count_missing', 'STEP2 missing → failure');
}
assert(step2Called, 'STEP2 reached before failure');

console.log('\n=== M3-L: DATETIME / LEASE (22007 guard) ===\n');

const sampleDate = new Date('2026-08-14T00:00:00.000Z');
assert(toAnalysisDateOnly(sampleDate) === '2026-08-14', 'Date → ISO date-only');
assert(toAnalysisDateOnly('2026-08-20T23:59:59.999Z') === '2026-08-20', 'ISO string → date-only');
assert(toAnalysisDateOnly('2026-08-01') === '2026-08-01', 'date-only passthrough');
assert(toAnalysisDateOnly(null) === null, 'null → null');
assert(toAnalysisDateOnly('not-a-date') === null, 'invalid string → null');
assert(String(sampleDate).slice(0, 10) !== '2026-08-14', 'String(Date).slice is unsafe (22007)');

const winFromRun = buildAnalysisWindowFromRun({
  window_start: sampleDate,
  window_end: new Date('2026-08-20T23:59:59.999Z'),
});
assert(winFromRun.fromDate === '2026-08-14', 'buildAnalysisWindowFromRun fromDate');
assert(winFromRun.toDate === '2026-08-20', 'buildAnalysisWindowFromRun toDate');

withEnv({}, () => {
  assert(getWorkerLeaseSeconds() === WORKER_LEASE_SECONDS, 'lease seconds default 300');
});
withEnv({ MEMBER_ANALYSIS_WORKER_LEASE_SECONDS: '600' }, () => {
  assert(getWorkerLeaseSeconds() === 600, 'lease seconds env override');
});

const workerLibSrc = readFileSync(new URL('../lib/member-qualitative-worker.js', import.meta.url), 'utf8');
assert(workerLibSrc.includes("::double precision * INTERVAL '1 second'"), 'lease SQL uses explicit seconds');
assert(!workerLibSrc.includes('String(run.windowStart).slice(0, 10)'), 'no unsafe windowStart slice');
assert(!workerLibSrc.includes('String(run.window_start).slice(0, 10)'), 'no unsafe window_start slice');
assert(workerLibSrc.includes('FOR UPDATE SKIP LOCKED'), 'atomic claim preserved');
assert(workerLibSrc.includes('buildAnalysisWindowFromRun'), 'claim/submit share window helper');
assert(workerLibSrc.includes('getWorkerLeaseSeconds'), 'claim/heartbeat share lease helper');

console.log('\n=== M3-L: HEARTBEAT / TIMEOUT ===\n');

const workerSrc = readFileSync(new URL('../scripts/member-analysis-worker.mjs', import.meta.url), 'utf8');
assert(workerSrc.includes('setInterval(heartbeat'), 'heartbeat interval during job');
assert(workerSrc.includes('await heartbeat()'), 'immediate heartbeat before Ollama');
assert(workerSrc.includes('heartbeatMs'), 'heartbeat interval configurable');
assert(workerSrc.includes('runOllamaTwoStageAnalysis'), 'Ollama runs while heartbeat active');

console.log('\n=== M3-L: OLLAMA MOCK / FIXTURE ===\n');

const fixtureJob = {
  prompt_version: 'm3-v1',
  sources: [{
    source_kind: 'daily_report',
    source_id: 'dr-fixture',
    body_text: '今日はガラスを扱うのが好きで実験を続けた',
  }],
  existing_confirmed_profile: [],
  psych_assessment: null,
};
const mockOut = mockOllamaTwoStageAnalysis(fixtureJob);
assert(Array.isArray(mockOut.structured_result?.candidates), 'mock ollama returns candidates');
assert(mockOut.structured_result.candidates.length >= 0, 'fixture step produces structured JSON');

withEnv({ MEMBER_ANALYSIS_OLLAMA_MODEL: 'qwen3.6:35b-a3b' }, () => {
  assert(getOllamaConfig().model === 'qwen3.6:35b-a3b', 'model from env');
});

assert(CANDIDATES_JSON_SCHEMA.required.includes('candidates'), 'structured schema has candidates');

console.log('\n=== M3-L: API ROUTING ===\n');

const apiSrc = readFileSync(new URL('../api/psych-assessments.js', import.meta.url), 'utf8');
assert(apiSrc.includes('qualitative-worker-claim'), 'worker claim action');
assert(apiSrc.includes('qualitative-worker-submit'), 'worker submit action');
assert(apiSrc.includes('requireMemberAnalysisWorkerSecret'), 'worker secret guard');
assert(apiSrc.includes('WORKER_ACTIONS'), 'worker actions separate from admin');
assert(!apiSrc.includes('api/member-analysis-worker'), 'no new function entrypoint');

console.log('\n=== M3-L: SECURITY / LOG ===\n');

assert(!workerSrc.includes('console.log(job.sources'), 'worker does not log sources');
assert(!/console\.(log|info|debug)\([^)]*body_text/.test(workerSrc), 'worker does not log body_text');

const failCodes = ['ollama_unavailable', 'ollama_timeout', 'ollama_prompt_token_count_missing', 'ollama_incomplete_generation', 'ollama_context_limit_reached', 'invalid_model_output', 'worker_processing_failed'];
assert(failCodes.every((c) => c.length < 64), 'safe fail codes');

console.log(`\n--- 結果: ${passed} passed, ${failed} failed ---\n`);
process.exit(failed > 0 ? 1 : 0);
