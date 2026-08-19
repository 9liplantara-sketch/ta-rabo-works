/**
 * Phase M3-L — Local Worker queue / claim / submit / fingerprint
 */

import { createHash, randomUUID } from 'node:crypto';
import { getDb } from './db.js';
import { assertQualitativeAdmin } from './member-qualitative-access.js';
import {
  QUALITATIVE_PROMPT_VERSION,
  WORKER_LEASE_SECONDS,
  WORKER_MAX_ATTEMPTS,
  WORKER_MODEL_PROVIDER,
  ANALYSIS_INPUT_MAX_CHARS_DEFAULT,
  ANALYSIS_PROMPT_OVERHEAD_CHARS,
} from './member-qualitative-constants.js';
import {
  fetchAnalysisSourcesForStudent,
  parseAnalysisWindow,
  buildAllowedSourceIdSet,
  buildSourceMetaMap,
  formatSourcesForAiPrompt,
} from './member-qualitative-sources.js';
import { validateAiOutput } from './member-qualitative-ai.js';
import { listPsychAssessments, mapPsychAssessmentForClient } from './psych-assessments.js';

export const WORKER_ADMIN_USER = { role: 'admin', email: 'member-analysis-worker@system' };

/** YYYY-MM-DD — Date / ISO / date-only を安全に正規化（String(date).slice は 22007 の原因） */
export function toAnalysisDateOnly(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value.toISOString().slice(0, 10);
  }
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

/** DB run row → fetchAnalysisSourcesForStudent 用 window（claim / submit 共通） */
export function buildAnalysisWindowFromRun(row) {
  const windowStart = row?.window_start ?? row?.windowStart ?? null;
  const windowEnd = row?.window_end ?? row?.windowEnd ?? null;
  const fromDate = toAnalysisDateOnly(windowStart);
  const toDate = toAnalysisDateOnly(windowEnd);
  if (!fromDate || !toDate) {
    const err = new Error('invalid_analysis_window');
    err.code = 'invalid_analysis_window';
    err.status = 500;
    throw err;
  }
  return {
    windowStart,
    windowEnd,
    fromDate,
    toDate,
  };
}

/** lease 秒数 — env override 可、常に正の整数 */
export function getWorkerLeaseSeconds() {
  const raw = Number(process.env.MEMBER_ANALYSIS_WORKER_LEASE_SECONDS ?? WORKER_LEASE_SECONDS);
  if (!Number.isFinite(raw) || raw <= 0) return WORKER_LEASE_SECONDS;
  return Math.floor(raw);
}

let workerColumnsReadyCache = null;

export function resetWorkerColumnsReadyCacheForTests() {
  workerColumnsReadyCache = null;
}

export async function isWorkerColumnsReady() {
  const override = process.env.MEMBER_ANALYSIS_WORKER_COLUMNS_READY_OVERRIDE;
  if (override === '0') return false;
  if (override === '1') return true;

  if (workerColumnsReadyCache !== null) return workerColumnsReadyCache;
  try {
    const sql = getDb();
    const rows = await sql`
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'member_analysis_runs'
        AND column_name = 'claim_token'
      LIMIT 1
    `;
    workerColumnsReadyCache = rows.length > 0;
  } catch {
    workerColumnsReadyCache = false;
  }
  return workerColumnsReadyCache;
}

export async function assertWorkerColumnsReadyAsync() {
  const ready = await isWorkerColumnsReady();
  if (!ready) {
    const err = new Error('member_analysis_worker_not_ready');
    err.status = 503;
    err.code = 'member_analysis_worker_not_ready';
    throw err;
  }
}

export function getAnalysisInputMaxChars() {
  const raw = Number(process.env.MEMBER_ANALYSIS_MAX_INPUT_CHARS);
  if (Number.isFinite(raw) && raw > 0) return raw;
  return ANALYSIS_INPUT_MAX_CHARS_DEFAULT;
}

/** fingerprint: source_kind + source_id + visibility + version timestamp */
export function buildFingerprintPartsFromSources(sources) {
  return (sources || []).map((s) => ({
    sourceKind: s.sourceKind || s.source_kind,
    sourceId: String(s.sourceId || s.source_id),
    visibility: String(s.visibility || 'unknown'),
    versionTs: String(s.updatedAt || s.createdAt || s.occurredAt || ''),
  }));
}

export function computeAnalysisInputFingerprint(sources) {
  const parts = buildFingerprintPartsFromSources(sources)
    .map((p) => `${p.sourceKind}:${p.sourceId}:${p.visibility}:${p.versionTs}`)
    .sort();
  return createHash('sha256').update(parts.join('|')).digest('hex');
}

export function computeAnalysisInputSize(sources, promptOverheadChars = ANALYSIS_PROMPT_OVERHEAD_CHARS) {
  const bodySize = (sources || []).reduce(
    (sum, s) => sum + String(s.bodyText || s.body_text || '').length,
    0,
  );
  return bodySize + Math.max(0, Number(promptOverheadChars) || 0);
}

/** Worker payload — student name / email を含めない */
export function formatWorkerPayloadSources(sources) {
  return (sources || []).map((s) => ({
    source_kind: s.sourceKind,
    source_id: s.sourceId,
    source_type: s.sourceType,
    occurred_at: s.occurredAt,
    title: s.sourceKind === 'daily_report' ? '日報' : String(s.sourceType || 'knowledge_record'),
    body_text: s.bodyText,
  }));
}

export function buildWorkerJobPayload({
  runId,
  claimToken,
  studentId,
  windowStart,
  windowEnd,
  sources,
  existingConfirmed,
  psychAssessment,
  inputFingerprint,
}) {
  const psych = psychAssessment
    ? { assessment_id: psychAssessment.id, scores: psychAssessment.scores || {} }
    : null;

  return {
    run_id: runId,
    claim_token: claimToken,
    student_id: studentId,
    window_start: windowStart,
    window_end: windowEnd,
    prompt_version: QUALITATIVE_PROMPT_VERSION,
    sources: formatWorkerPayloadSources(sources),
    existing_confirmed_profile: (existingConfirmed || []).map((i) => ({
      id: i.id,
      category: i.category,
      statement: i.statement,
      epistemic_type: i.epistemicType || i.epistemic_type,
    })),
    psych_assessment: psych,
    input_fingerprint: inputFingerprint,
  };
}

async function listConfirmedProfileSummary(studentId) {
  const sql = getDb();
  const rows = await sql`
    SELECT id, category, statement, epistemic_type
    FROM member_profile_items
    WHERE student_id = ${studentId}::uuid
      AND status = 'confirmed'
    ORDER BY last_observed_at DESC NULLS LAST, created_at DESC
  `;
  return rows.map((r) => ({
    id: r.id,
    category: r.category,
    statement: r.statement,
    epistemicType: r.epistemic_type,
  }));
}

async function getLatestPsychForWorker(studentId) {
  const rows = await listPsychAssessments({ studentId });
  return rows[0] ? mapPsychAssessmentForClient(rows[0]) : null;
}

export async function fetchAnalysisContextForStudent(studentId, window) {
  const bundle = await fetchAnalysisSourcesForStudent(WORKER_ADMIN_USER, studentId, window);
  const confirmed = await listConfirmedProfileSummary(studentId);
  const psych = await getLatestPsychForWorker(studentId);
  const fingerprint = computeAnalysisInputFingerprint(bundle.sources);
  return {
    ...bundle,
    confirmed,
    psych,
    fingerprint,
  };
}

export async function enqueueLocalWorkerAnalysis(user, studentId, windowInput = {}) {
  assertQualitativeAdmin(user);
  if (!studentId) throw Object.assign(new Error('student_id は必須です'), { status: 400 });

  const window = parseAnalysisWindow(windowInput);
  const sql = getDb();

  const ctx = await fetchAnalysisContextForStudent(studentId, window);

  const runRows = await sql`
    INSERT INTO member_analysis_runs (
      student_id, window_start, window_end, prompt_version,
      status, source_count, daily_report_count, knowledge_record_count,
      psych_assessment_id, input_fingerprint, model_provider,
      created_at
    ) VALUES (
      ${studentId},
      ${window.windowStart},
      ${window.windowEnd},
      ${QUALITATIVE_PROMPT_VERSION},
      'pending',
      ${ctx.sourceCount},
      ${ctx.dailyReportCount},
      ${ctx.knowledgeRecordCount},
      ${ctx.psych?.id || null},
      ${ctx.fingerprint},
      'local_worker',
      NOW()
    )
    RETURNING id, status
  `;

  return {
    ok: true,
    run_id: runRows[0].id,
    runId: runRows[0].id,
    status: 'pending',
    provider: 'local_worker',
    sourceCount: ctx.sourceCount,
    dailyReportCount: ctx.dailyReportCount,
    knowledgeRecordCount: ctx.knowledgeRecordCount,
  };
}

function mapRunRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    studentId: row.student_id,
    windowStart: row.window_start,
    windowEnd: row.window_end,
    status: row.status,
    claimToken: row.claim_token,
    workerId: row.worker_id,
    attemptCount: row.attempt_count,
    leaseExpiresAt: row.lease_expires_at,
    inputFingerprint: row.input_fingerprint,
    promptVersion: row.prompt_version,
  };
}

export async function markExpiredRunsFailed(sql) {
  await sql`
    UPDATE member_analysis_runs
    SET status = 'failed',
        error_text = 'worker_max_attempts_exceeded',
        completed_at = NOW()
    WHERE status = 'running'
      AND lease_expires_at IS NOT NULL
      AND lease_expires_at < NOW()
      AND attempt_count >= ${WORKER_MAX_ATTEMPTS}
  `;
}

export async function claimNextWorkerJob(workerId) {
  await assertWorkerColumnsReadyAsync();
  const sql = getDb();
  const wid = String(workerId || 'local-worker').trim() || 'local-worker';

  await markExpiredRunsFailed(sql);

  const claimToken = randomUUID();
  const leaseSeconds = getWorkerLeaseSeconds();

  const rows = await sql`
    WITH candidate AS (
      SELECT id
      FROM member_analysis_runs
      WHERE status = 'pending'
         OR (
           status = 'running'
           AND lease_expires_at IS NOT NULL
           AND lease_expires_at < NOW()
           AND attempt_count < ${WORKER_MAX_ATTEMPTS}
         )
      ORDER BY created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    UPDATE member_analysis_runs r
    SET status = 'running',
        worker_id = ${wid},
        claim_token = ${claimToken}::uuid,
        claimed_at = NOW(),
        lease_expires_at = NOW() + (${leaseSeconds}::double precision * INTERVAL '1 second'),
        attempt_count = r.attempt_count + 1,
        started_at = COALESCE(r.started_at, NOW()),
        error_text = NULL
    FROM candidate c
    WHERE r.id = c.id
    RETURNING r.*
  `;

  if (!rows.length) {
    return { ok: true, job: null };
  }

  const run = mapRunRow(rows[0]);
  const window = buildAnalysisWindowFromRun(rows[0]);

  const ctx = await fetchAnalysisContextForStudent(run.studentId, window);
  const inputSize = computeAnalysisInputSize(ctx.sources);

  if (inputSize > getAnalysisInputMaxChars()) {
    await sql`
      UPDATE member_analysis_runs
      SET status = 'failed',
          error_text = 'analysis_input_too_large',
          completed_at = NOW()
      WHERE id = ${run.id}::uuid
    `;
    return { ok: true, job: null, skipped: 'analysis_input_too_large', run_id: run.id };
  }

  if (!ctx.sourceCount) {
    await sql`
      UPDATE member_analysis_runs
      SET status = 'failed',
          error_text = 'analysis_input_empty',
          completed_at = NOW()
      WHERE id = ${run.id}::uuid
    `;
    return { ok: true, job: null, skipped: 'analysis_input_empty', run_id: run.id };
  }

  if (ctx.fingerprint !== run.inputFingerprint) {
    await sql`
      UPDATE member_analysis_runs
      SET input_fingerprint = ${ctx.fingerprint},
          source_count = ${ctx.sourceCount},
          daily_report_count = ${ctx.dailyReportCount},
          knowledge_record_count = ${ctx.knowledgeRecordCount}
      WHERE id = ${run.id}::uuid
    `;
    run.inputFingerprint = ctx.fingerprint;
  }

  const job = buildWorkerJobPayload({
    runId: run.id,
    claimToken,
    studentId: run.studentId,
    windowStart: run.windowStart,
    windowEnd: run.windowEnd,
    sources: ctx.sources,
    existingConfirmed: ctx.confirmed,
    psychAssessment: ctx.psych,
    inputFingerprint: ctx.fingerprint,
  });

  return { ok: true, job };
}

export async function loadRunForWorker(runId) {
  const sql = getDb();
  const rows = await sql`
    SELECT * FROM member_analysis_runs WHERE id = ${runId}::uuid LIMIT 1
  `;
  return rows[0] || null;
}

export function assertRunClaim(run, { workerId, claimToken }) {
  if (!run) {
    const err = new Error('run_not_found');
    err.status = 404;
    err.code = 'run_not_found';
    throw err;
  }
  if (run.status === 'completed') {
    return { alreadyCompleted: true };
  }
  if (String(run.worker_id || '') !== String(workerId || '')) {
    const err = new Error('stale_claim');
    err.status = 409;
    err.code = 'stale_claim';
    throw err;
  }
  if (String(run.claim_token || '') !== String(claimToken || '')) {
    const err = new Error('stale_claim');
    err.status = 409;
    err.code = 'stale_claim';
    throw err;
  }
  if (run.status !== 'running') {
    const err = new Error('run_not_running');
    err.status = 409;
    err.code = 'run_not_running';
    throw err;
  }
  return { alreadyCompleted: false };
}

export async function heartbeatWorkerJob(body = {}) {
  await assertWorkerColumnsReadyAsync();
  const runId = String(body.run_id || body.runId || '').trim();
  const workerId = String(body.worker_id || body.workerId || '').trim();
  const claimToken = String(body.claim_token || body.claimToken || '').trim();
  if (!runId || !workerId || !claimToken) {
    throw Object.assign(new Error('run_id, worker_id, claim_token は必須です'), { status: 400 });
  }

  const run = await loadRunForWorker(runId);
  assertRunClaim(run, { workerId, claimToken });

  const sql = getDb();
  const leaseSeconds = getWorkerLeaseSeconds();
  await sql`
    UPDATE member_analysis_runs
    SET lease_expires_at = NOW() + (${leaseSeconds}::double precision * INTERVAL '1 second')
    WHERE id = ${runId}::uuid
      AND claim_token = ${claimToken}::uuid
      AND worker_id = ${workerId}
      AND status = 'running'
  `;

  return { ok: true, lease_extended: true };
}

async function insertCandidateWithEvidence(sql, studentId, runId, candidate, allowedKeys, sourceMetaByKey) {
  const validation = validateAiOutput({ candidates: [candidate] }, allowedKeys, sourceMetaByKey);
  if (!validation.valid.length) {
    return { ok: false, errors: validation.rejected[0]?.errors || ['invalid candidate'] };
  }

  const c = validation.valid[0];
  const observedDates = (c.evidence || []).map((ev) => ev.observed_at).filter(Boolean);

  const itemRows = await sql`
    INSERT INTO member_profile_items (
      student_id, category, statement, epistemic_type, confidence,
      status, related_item_id, relation_type,
      first_observed_at, last_observed_at, analysis_run_id
    ) VALUES (
      ${studentId},
      ${c.category},
      ${String(c.statement).trim()},
      ${c.epistemic_type},
      ${c.confidence},
      'candidate',
      ${c.related_item_id || null},
      ${c.relation_type || 'new'},
      ${observedDates[0] || new Date().toISOString()},
      ${observedDates[observedDates.length - 1] || new Date().toISOString()},
      ${runId}
    )
    RETURNING id
  `;

  const itemId = itemRows[0].id;
  for (const ev of c.evidence || []) {
    await sql`
      INSERT INTO member_profile_evidence (
        profile_item_id, source_kind, source_id, evidence_role, observed_at
      ) VALUES (
        ${itemId},
        ${ev.source_kind},
        ${ev.source_id},
        ${ev.evidence_role || 'supports'},
        ${ev.observed_at || null}
      )
    `;
  }

  return { ok: true, itemId };
}

export async function submitWorkerJobResult(body = {}) {
  await assertWorkerColumnsReadyAsync();
  const runId = String(body.run_id || body.runId || '').trim();
  const workerId = String(body.worker_id || body.workerId || '').trim();
  const claimToken = String(body.claim_token || body.claimToken || '').trim();
  const inputFingerprint = String(body.input_fingerprint || body.inputFingerprint || '').trim();
  const modelName = String(body.model || body.model_name || body.modelName || '').trim() || null;
  const promptVersion = String(body.prompt_version || body.promptVersion || QUALITATIVE_PROMPT_VERSION).trim();
  const structured = body.structured_result || body.structuredResult || body;

  if (!runId || !workerId || !claimToken || !inputFingerprint) {
    throw Object.assign(new Error('run_id, worker_id, claim_token, input_fingerprint は必須です'), { status: 400 });
  }

  const sql = getDb();
  const run = await loadRunForWorker(runId);
  const claimCheck = assertRunClaim(run, { workerId, claimToken });
  if (claimCheck.alreadyCompleted) {
    return { ok: true, already_completed: true, run_id: runId, status: 'completed' };
  }

  const window = buildAnalysisWindowFromRun(run);

  const ctx = await fetchAnalysisContextForStudent(run.student_id, window);

  if (ctx.fingerprint !== inputFingerprint || ctx.fingerprint !== run.input_fingerprint) {
    await sql`
      UPDATE member_analysis_runs
      SET status = 'failed',
          error_text = 'analysis_input_stale',
          completed_at = NOW()
      WHERE id = ${runId}::uuid
    `;
    const err = new Error('analysis_input_stale');
    err.status = 409;
    err.code = 'analysis_input_stale';
    throw err;
  }

  const allowedKeys = buildAllowedSourceIdSet(ctx.sources);
  const sourceMetaByKey = buildSourceMetaMap(ctx.sources);
  const candidates = Array.isArray(structured?.candidates) ? structured.candidates : [];

  const { valid, rejected } = validateAiOutput({ candidates }, allowedKeys, sourceMetaByKey);

  if (!valid.length && candidates.length) {
    await sql`
      UPDATE member_analysis_runs
      SET status = 'failed',
          error_text = 'invalid_model_output',
          completed_at = NOW()
      WHERE id = ${runId}::uuid
    `;
    const err = new Error('invalid_model_output');
    err.status = 422;
    err.code = 'invalid_model_output';
    throw err;
  }

  let created = 0;
  for (const c of valid) {
    const ins = await insertCandidateWithEvidence(
      sql, run.student_id, runId, c, allowedKeys, sourceMetaByKey,
    );
    if (ins.ok) created += 1;
  }

  await sql`
    UPDATE member_analysis_runs
    SET status = 'completed',
        created_candidates = ${created},
        model_provider = ${WORKER_MODEL_PROVIDER},
        model_name = ${modelName},
        prompt_version = ${promptVersion},
        source_count = ${ctx.sourceCount},
        daily_report_count = ${ctx.dailyReportCount},
        knowledge_record_count = ${ctx.knowledgeRecordCount},
        psych_assessment_id = ${ctx.psych?.id || null},
        input_fingerprint = ${ctx.fingerprint},
        completed_at = NOW(),
        error_text = NULL
    WHERE id = ${runId}::uuid
      AND claim_token = ${claimToken}::uuid
      AND status = 'running'
  `;

  return {
    ok: true,
    run_id: runId,
    status: 'completed',
    created_candidates: created,
    rejected_count: rejected.length,
  };
}

const SAFE_FAIL_CODES = new Set([
  'ollama_unavailable',
  'ollama_timeout',
  'ollama_prompt_token_count_missing',
  'ollama_incomplete_generation',
  'ollama_context_limit_reached',
  'invalid_model_output',
  'worker_processing_failed',
  'analysis_input_stale',
  'analysis_input_empty',
  'analysis_input_too_large',
]);

export async function failWorkerJob(body = {}) {
  await assertWorkerColumnsReadyAsync();
  const runId = String(body.run_id || body.runId || '').trim();
  const workerId = String(body.worker_id || body.workerId || '').trim();
  const claimToken = String(body.claim_token || body.claimToken || '').trim();
  const errorCode = String(body.error_code || body.errorCode || 'worker_processing_failed').trim();

  if (!runId || !workerId || !claimToken) {
    throw Object.assign(new Error('run_id, worker_id, claim_token は必須です'), { status: 400 });
  }

  const safeCode = SAFE_FAIL_CODES.has(errorCode) ? errorCode : 'worker_processing_failed';

  const run = await loadRunForWorker(runId);
  if (run?.status === 'completed') {
    return { ok: true, already_completed: true };
  }

  try {
    assertRunClaim(run, { workerId, claimToken });
  } catch (e) {
    if (e.code === 'stale_claim') throw e;
    throw e;
  }

  const sql = getDb();
  await sql`
    UPDATE member_analysis_runs
    SET status = 'failed',
        error_text = ${safeCode},
        completed_at = NOW()
    WHERE id = ${runId}::uuid
      AND claim_token = ${claimToken}::uuid
      AND status = 'running'
  `;

  return { ok: true, run_id: runId, status: 'failed', error_code: safeCode };
}

export function filterStep2Candidates(step1Observations, step2Candidates) {
  const step1Keys = new Set(
    (step1Observations || []).map((o) => candidateIdentityKey(o)),
  );
  return (step2Candidates || []).filter((c) => step1Keys.has(candidateIdentityKey(c)));
}

export function candidateIdentityKey(candidate) {
  const ev = (candidate?.evidence || [])
    .map((e) => `${e.source_kind || e.sourceKind}:${e.source_id || e.sourceId}`)
    .sort()
    .join(',');
  return `${candidate?.category || ''}|${ev}`;
}

export {
  buildAllowedSourceIdSet,
  buildSourceMetaMap,
  formatSourcesForAiPrompt,
  computeAnalysisInputFingerprint as computeInputFingerprint,
};
