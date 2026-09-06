/**
 * Phase 6A/6B/6D — Local AI analysis consent (fail-closed)
 *
 * Phase 6B: consent_records 正本へ接続。
 * Phase 6D: required policy_version 完全一致を必須。
 * Form item_answers から同意を推測・自動生成しない。
 *
 * mock provider のみ免除（既存 M3 unit test 互換）。
 * local_worker は絶対に免除しない。Production generic bypass 禁止。
 */

import { getDb } from './db.js';

export const LOCAL_AI_ANALYSIS_PURPOSE = 'local_ai_analysis';

/**
 * Production required Local AI consent policy version（正式）。
 * 人間向け説明文の管理は docs/member-analysis-local-worker.md を参照。
 */
export const LOCAL_AI_ANALYSIS_POLICY_VERSION = 'local-ai-analysis-2026-v1';

export const CONSENT_TYPES = Object.freeze([
  'operational_use',
  'local_ai_analysis',
  'longitudinal_research',
  'post_graduation_contact',
]);

export const CONSENT_STATUSES = Object.freeze(['active', 'withdrawn']);

export const CONSENT_SOURCES = Object.freeze([
  'admin_recorded',
  'student_form',
  'migration',
]);

/** @deprecated Phase 6D: use LOCAL_AI_ANALYSIS_POLICY_VERSION */
export const LOCAL_AI_POLICY_VERSION_TEST_FIXTURE = LOCAL_AI_ANALYSIS_POLICY_VERSION;

let consentTableReadyCache = null;
let loadOverrideForTests = undefined;

export function resetConsentTableReadyCacheForTests() {
  consentTableReadyCache = null;
}

/** @param {((studentId: string, consentType?: string) => Promise<unknown>) | null | undefined} fn */
export function __testSetLocalAiConsentLoader(fn) {
  loadOverrideForTests = fn;
}

export function __testResetLocalAiConsentLoader() {
  loadOverrideForTests = undefined;
}

export async function isConsentRecordsTableReady() {
  const override = process.env.MEMBER_CONSENT_TABLE_READY_OVERRIDE;
  if (override === '0') return false;
  if (override === '1') return true;
  if (consentTableReadyCache !== null) return consentTableReadyCache;
  try {
    const sql = getDb();
    const rows = await sql`
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = 'consent_records'
      LIMIT 1
    `;
    consentTableReadyCache = rows.length > 0;
  } catch {
    consentTableReadyCache = false;
  }
  return consentTableReadyCache;
}

export async function assertConsentRecordsTableReadyAsync() {
  const ready = await isConsentRecordsTableReady();
  if (!ready) {
    const err = new Error('consent_records_not_ready');
    err.status = 503;
    err.code = 'consent_records_not_ready';
    throw err;
  }
}

export function isValidConsentType(value) {
  return CONSENT_TYPES.includes(String(value || '').trim());
}

export function isValidConsentSource(value) {
  return CONSENT_SOURCES.includes(String(value || '').trim());
}

export function normalizePolicyVersion(value) {
  const v = String(value || '').trim();
  return v || null;
}

/** Current required Local AI policy version（単一正本） */
export function getRequiredLocalAiAnalysisPolicyVersion() {
  return LOCAL_AI_ANALYSIS_POLICY_VERSION;
}

/**
 * @param {unknown} record
 * @returns {{ permitted: boolean, reason: string }}
 */
export function evaluateLocalAiAnalysisConsent(record) {
  if (record == null) {
    return { permitted: false, reason: 'consent_absent' };
  }
  if (typeof record !== 'object' || Array.isArray(record)) {
    return { permitted: false, reason: 'consent_unknown' };
  }

  const purpose = String(
    record.consent_type ?? record.consentType ?? record.purpose ?? '',
  ).trim();
  if (!purpose) {
    return { permitted: false, reason: 'consent_unknown' };
  }
  if (purpose !== LOCAL_AI_ANALYSIS_PURPOSE) {
    return { permitted: false, reason: 'consent_purpose_mismatch' };
  }

  const status = String(record.status ?? record.consent_status ?? record.consentStatus ?? '')
    .trim()
    .toLowerCase();

  if (!status) {
    return { permitted: false, reason: 'consent_unknown' };
  }

  if (status === 'active') {
    const policy = normalizePolicyVersion(record.policy_version ?? record.policyVersion);
    if (!policy) {
      return { permitted: false, reason: 'consent_unknown' };
    }
    // active + withdrawn_at set is inconsistent
    if (record.withdrawn_at != null || record.withdrawnAt != null) {
      return { permitted: false, reason: 'consent_unknown' };
    }
    const required = getRequiredLocalAiAnalysisPolicyVersion();
    if (policy !== required) {
      return { permitted: false, reason: 'consent_policy_outdated' };
    }
    return { permitted: true, reason: 'consent_active' };
  }

  if (status === 'withdrawn') {
    return { permitted: false, reason: 'consent_withdrawn' };
  }

  return { permitted: false, reason: 'consent_unknown' };
}

function mapConsentRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    student_id: row.student_id,
    consent_type: row.consent_type,
    policy_version: row.policy_version,
    status: row.status,
    consented_at: row.consented_at,
    withdrawn_at: row.withdrawn_at ?? null,
    source: row.source,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * current active row（なければ null）。履歴 withdrawn は含めない。
 */
export async function getActiveConsentRecord(studentId, consentType = LOCAL_AI_ANALYSIS_PURPOSE) {
  const sid = String(studentId || '').trim();
  const ctype = String(consentType || '').trim();
  if (!sid || !isValidConsentType(ctype)) return null;

  await assertConsentRecordsTableReadyAsync();
  const sql = getDb();
  const rows = await sql`
    SELECT id, student_id, consent_type, policy_version, status,
           consented_at, withdrawn_at, source, created_at, updated_at
    FROM consent_records
    WHERE student_id = ${sid}::uuid
      AND consent_type = ${ctype}
      AND status = 'active'
    LIMIT 1
  `;
  return mapConsentRow(rows[0] || null);
}

/**
 * Runtime loader for Local AI gate.
 * - active → that row
 * - no active but history → stub { status: withdrawn, consent_type }
 * - no rows → null (absent)
 */
export async function loadLocalAiAnalysisConsentRecord(studentId) {
  if (loadOverrideForTests !== undefined) {
    if (typeof loadOverrideForTests === 'function') {
      return loadOverrideForTests(studentId, LOCAL_AI_ANALYSIS_PURPOSE);
    }
    return loadOverrideForTests;
  }

  const sid = String(studentId || '').trim();
  if (!sid) return null;

  const ready = await isConsentRecordsTableReady();
  if (!ready) {
    // store 未整備 = 正本確認不可 → absent 扱いで fail-closed
    return null;
  }

  const sql = getDb();
  const active = await sql`
    SELECT id, student_id, consent_type, policy_version, status,
           consented_at, withdrawn_at, source, created_at, updated_at
    FROM consent_records
    WHERE student_id = ${sid}::uuid
      AND consent_type = ${LOCAL_AI_ANALYSIS_PURPOSE}
      AND status = 'active'
    LIMIT 1
  `;
  if (active[0]) return mapConsentRow(active[0]);

  const history = await sql`
    SELECT id, student_id, consent_type, policy_version, status,
           consented_at, withdrawn_at, source, created_at, updated_at
    FROM consent_records
    WHERE student_id = ${sid}::uuid
      AND consent_type = ${LOCAL_AI_ANALYSIS_PURPOSE}
    ORDER BY COALESCE(withdrawn_at, consented_at) DESC, created_at DESC
    LIMIT 1
  `;
  if (history[0]) {
    return {
      ...mapConsentRow(history[0]),
      status: 'withdrawn',
    };
  }

  return null;
}

/**
 * @param {string} studentId
 * @param {{ provider?: string | null }} [opts]
 */
export async function resolveLocalAiAnalysisConsent(studentId, opts = {}) {
  const provider = String(opts.provider || '').trim();
  if (provider === 'mock') {
    return { permitted: true, reason: 'mock_provider_exempt' };
  }

  const record = await loadLocalAiAnalysisConsentRecord(studentId);
  return evaluateLocalAiAnalysisConsent(record);
}

/**
 * Local worker / 実 Local AI 開始前の fail-closed gate。
 * @param {string} studentId
 * @param {{ provider?: string | null }} [opts]
 */
export async function assertLocalAiAnalysisConsentOrThrow(studentId, opts = {}) {
  const decision = await resolveLocalAiAnalysisConsent(studentId, opts);
  if (!decision.permitted) {
    const err = new Error(decision.reason || 'local_ai_consent_required');
    err.status = 403;
    err.code = decision.reason || 'local_ai_consent_required';
    throw err;
  }
  return decision;
}

/**
 * Admin recording: 管理者が「別途取得済みの同意」を正本へ記録する。
 * API 呼び出し自体が同意取得を意味しない。
 *
 * @param {{
 *   studentId: string,
 *   consentType?: string,
 *   policyVersion: string,
 *   consentedAt: string | Date,
 *   source?: string,
 * }} input
 */
export async function recordConsentEpisode(input) {
  await assertConsentRecordsTableReadyAsync();

  const studentId = String(input?.studentId || '').trim();
  const consentType = String(input?.consentType || LOCAL_AI_ANALYSIS_PURPOSE).trim();
  const policyVersion = normalizePolicyVersion(input?.policyVersion);
  const source = String(input?.source || 'admin_recorded').trim();

  if (!studentId) {
    const err = new Error('student_id は必須です');
    err.status = 400;
    err.code = 'student_id_required';
    throw err;
  }
  if (!isValidConsentType(consentType)) {
    const err = new Error('invalid_consent_type');
    err.status = 400;
    err.code = 'invalid_consent_type';
    throw err;
  }
  if (!policyVersion) {
    const err = new Error('policy_version は必須です');
    err.status = 400;
    err.code = 'policy_version_required';
    throw err;
  }
  if (
    consentType === LOCAL_AI_ANALYSIS_PURPOSE
    && policyVersion !== getRequiredLocalAiAnalysisPolicyVersion()
  ) {
    const err = new Error('consent_policy_version_mismatch');
    err.status = 400;
    err.code = 'consent_policy_version_mismatch';
    throw err;
  }
  if (!isValidConsentSource(source)) {
    const err = new Error('invalid_consent_source');
    err.status = 400;
    err.code = 'invalid_consent_source';
    throw err;
  }

  let consentedAt;
  if (input.consentedAt instanceof Date) {
    consentedAt = input.consentedAt;
  } else {
    consentedAt = new Date(String(input.consentedAt || ''));
  }
  if (Number.isNaN(consentedAt.getTime())) {
    const err = new Error('consented_at が不正です');
    err.status = 400;
    err.code = 'invalid_consented_at';
    throw err;
  }

  const existing = await getActiveConsentRecord(studentId, consentType);
  if (existing) {
    const err = new Error('active_consent_already_exists');
    err.status = 409;
    err.code = 'active_consent_already_exists';
    throw err;
  }

  const sql = getDb();
  try {
    const rows = await sql`
      INSERT INTO consent_records (
        student_id, consent_type, policy_version, status,
        consented_at, withdrawn_at, source
      ) VALUES (
        ${studentId}::uuid,
        ${consentType},
        ${policyVersion},
        'active',
        ${consentedAt.toISOString()},
        NULL,
        ${source}
      )
      RETURNING id, student_id, consent_type, policy_version, status,
                consented_at, withdrawn_at, source, created_at, updated_at
    `;
    return mapConsentRow(rows[0]);
  } catch (e) {
    const msg = String(e?.message || e);
    if (/idx_consent_records_student_type_active_unique|unique/i.test(msg)) {
      const err = new Error('active_consent_already_exists');
      err.status = 409;
      err.code = 'active_consent_already_exists';
      throw err;
    }
    throw e;
  }
}

/**
 * active → withdrawn（DELETE しない）
 */
export async function withdrawConsentEpisode(input) {
  await assertConsentRecordsTableReadyAsync();

  const studentId = String(input?.studentId || '').trim();
  const consentType = String(input?.consentType || LOCAL_AI_ANALYSIS_PURPOSE).trim();

  if (!studentId) {
    const err = new Error('student_id は必須です');
    err.status = 400;
    err.code = 'student_id_required';
    throw err;
  }
  if (!isValidConsentType(consentType)) {
    const err = new Error('invalid_consent_type');
    err.status = 400;
    err.code = 'invalid_consent_type';
    throw err;
  }

  let withdrawnAt;
  if (input?.withdrawnAt instanceof Date) {
    withdrawnAt = input.withdrawnAt;
  } else if (input?.withdrawnAt) {
    withdrawnAt = new Date(String(input.withdrawnAt));
  } else {
    withdrawnAt = new Date();
  }
  if (Number.isNaN(withdrawnAt.getTime())) {
    const err = new Error('withdrawn_at が不正です');
    err.status = 400;
    err.code = 'invalid_withdrawn_at';
    throw err;
  }

  const sql = getDb();
  const rows = await sql`
    UPDATE consent_records
    SET status = 'withdrawn',
        withdrawn_at = ${withdrawnAt.toISOString()}
    WHERE student_id = ${studentId}::uuid
      AND consent_type = ${consentType}
      AND status = 'active'
    RETURNING id, student_id, consent_type, policy_version, status,
              consented_at, withdrawn_at, source, created_at, updated_at
  `;

  if (!rows[0]) {
    const err = new Error('active_consent_not_found');
    err.status = 404;
    err.code = 'active_consent_not_found';
    throw err;
  }

  return mapConsentRow(rows[0]);
}

/**
 * Admin status view — active + recent history (no Form inference)
 */
export async function getConsentStatusForStudent(studentId, consentType = LOCAL_AI_ANALYSIS_PURPOSE) {
  await assertConsentRecordsTableReadyAsync();
  const sid = String(studentId || '').trim();
  const ctype = String(consentType || LOCAL_AI_ANALYSIS_PURPOSE).trim();
  if (!sid) {
    const err = new Error('student_id は必須です');
    err.status = 400;
    err.code = 'student_id_required';
    throw err;
  }
  if (!isValidConsentType(ctype)) {
    const err = new Error('invalid_consent_type');
    err.status = 400;
    err.code = 'invalid_consent_type';
    throw err;
  }

  const sql = getDb();
  const rows = await sql`
    SELECT id, student_id, consent_type, policy_version, status,
           consented_at, withdrawn_at, source, created_at, updated_at
    FROM consent_records
    WHERE student_id = ${sid}::uuid
      AND consent_type = ${ctype}
    ORDER BY consented_at DESC, created_at DESC
    LIMIT 20
  `;

  const mapped = rows.map(mapConsentRow);
  const active = mapped.find((r) => r.status === 'active') || null;
  const decision = evaluateLocalAiAnalysisConsent(
    active || (mapped[0] ? { ...mapped[0], status: 'withdrawn' } : null),
  );

  return {
    student_id: sid,
    consent_type: ctype,
    active,
    history: mapped,
    decision,
  };
}

/**
 * In-memory lifecycle simulator for unit tests (no DB).
 * Mirrors record → withdraw → re-consent episode semantics.
 */
export function createInMemoryConsentStore() {
  /** @type {object[]} */
  const rows = [];
  let seq = 0;

  function list(studentId, consentType) {
    return rows.filter(
      (r) => r.student_id === studentId && r.consent_type === consentType,
    );
  }

  return {
    rows,
    record({ studentId, consentType = LOCAL_AI_ANALYSIS_PURPOSE, policyVersion, consentedAt, source = 'admin_recorded' }) {
      const normalized = normalizePolicyVersion(policyVersion);
      if (!normalized) {
        const err = new Error('policy_version_required');
        err.code = 'policy_version_required';
        throw err;
      }
      if (
        consentType === LOCAL_AI_ANALYSIS_PURPOSE
        && normalized !== getRequiredLocalAiAnalysisPolicyVersion()
      ) {
        const err = new Error('consent_policy_version_mismatch');
        err.code = 'consent_policy_version_mismatch';
        throw err;
      }
      if (list(studentId, consentType).some((r) => r.status === 'active')) {
        const err = new Error('active_consent_already_exists');
        err.code = 'active_consent_already_exists';
        throw err;
      }
      const row = {
        id: `mem-${++seq}`,
        student_id: studentId,
        consent_type: consentType,
        policy_version: normalized,
        status: 'active',
        consented_at: consentedAt,
        withdrawn_at: null,
        source,
      };
      rows.push(row);
      return row;
    },
    withdraw({ studentId, consentType = LOCAL_AI_ANALYSIS_PURPOSE, withdrawnAt = new Date().toISOString() }) {
      const active = list(studentId, consentType).find((r) => r.status === 'active');
      if (!active) {
        const err = new Error('active_consent_not_found');
        err.code = 'active_consent_not_found';
        throw err;
      }
      active.status = 'withdrawn';
      active.withdrawn_at = withdrawnAt;
      return active;
    },
    loadLocalAi(studentId) {
      const all = list(studentId, LOCAL_AI_ANALYSIS_PURPOSE);
      const active = all.find((r) => r.status === 'active');
      if (active) return active;
      if (all.length) return { ...all[all.length - 1], status: 'withdrawn' };
      return null;
    },
  };
}
