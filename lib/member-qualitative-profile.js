/**
 * Phase M3 — 定性プロフィール CRUD / 分析実行 / レビュー
 */

import { getDb } from './db.js';
import { listPsychAssessments, mapPsychAssessmentForClient } from './psych-assessments.js';
import { assertQualitativeAdmin } from './member-qualitative-access.js';
import {
  PROFILE_CATEGORIES,
  VALID_CATEGORIES,
  VALID_EPISTEMIC_TYPES,
  CONFIDENCE_LEVELS,
  ITEM_STATUSES,
  RELATION_TYPES,
  QUALITATIVE_PROMPT_VERSION,
} from './member-qualitative-constants.js';
import {
  fetchAnalysisSourcesForStudent,
  parseAnalysisWindow,
  formatSourcesForAiPrompt,
  buildAllowedSourceIdSet,
  buildSourceMetaMap,
  sourceKey,
} from './member-qualitative-sources.js';
import {
  filterAccessibleEvidence,
  isEvidenceSourceAccessible,
} from './member-qualitative-evidence.js';
import {
  validateAiOutput,
  validateSelfReportProvenance,
  runQualitativeAiAnalysis,
  assertAiProviderReadyForAnalysis,
  assertSyncAiProviderForExecution,
  resolveAiProviderRuntime,
  isQueueBasedProvider,
  fingerprintSources,
} from './member-qualitative-ai.js';
import { enqueueLocalWorkerAnalysis, isWorkerColumnsReady } from './member-qualitative-worker.js';
import {
  buildDailyReportBodyText,
  mapDailyReportToKnowledgeSource,
  mapKnowledgeRecordToSource,
} from './knowledge-sources.js';
import { isDailyReportEligibleForKnowledge } from './knowledge-access.js';
import { canViewKnowledgeRecord } from './knowledge-access.js';
import { loadParticipantsForRecords } from './knowledge-records.js';
import { mapKnowledgeRecordRow } from './knowledge-records.js';

export { PROFILE_CATEGORIES, parseAnalysisWindow };

let qualitativeTableReadyCache = null;

export function resetQualitativeTableReadyCacheForTests() {
  qualitativeTableReadyCache = null;
}

export async function isMemberQualitativeProfileTableReady() {
  const override = process.env.MEMBER_QUALITATIVE_TABLE_READY_OVERRIDE;
  if (override === '0') return false;
  if (override === '1') return true;

  if (qualitativeTableReadyCache !== null) return qualitativeTableReadyCache;
  try {
    const sql = getDb();
    const rows = await sql`
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = 'member_profile_items'
      LIMIT 1
    `;
    qualitativeTableReadyCache = rows.length > 0;
  } catch {
    qualitativeTableReadyCache = false;
  }
  return qualitativeTableReadyCache;
}

export async function assertQualitativeTablesReadyAsync() {
  const ready = await isMemberQualitativeProfileTableReady();
  if (!ready) {
    const err = new Error('member_qualitative_profile_not_ready');
    err.status = 503;
    err.code = 'member_qualitative_profile_not_ready';
    throw err;
  }
}

export async function getQualitativeStatus() {
  const dbReady = await isMemberQualitativeProfileTableReady();
  const aiResolved = resolveAiProviderRuntime();
  return {
    db_ready: dbReady,
    ai_configured: aiResolved.status === 'ready',
    ai_provider: aiResolved.provider,
    ai_mode: aiResolved.mode || null,
  };
}

function mapItemRow(row, evidence = []) {
  if (!row) return null;
  return {
    id: row.id,
    studentId: row.student_id,
    category: row.category,
    statement: row.statement,
    epistemicType: row.epistemic_type,
    confidence: row.confidence,
    status: row.status,
    relatedItemId: row.related_item_id,
    relationType: row.relation_type,
    supersedesId: row.supersedes_id,
    firstObservedAt: row.first_observed_at,
    lastObservedAt: row.last_observed_at,
    analysisRunId: row.analysis_run_id,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    evidenceCount: evidence.length,
    accessibleEvidenceCount: evidence.filter((e) => e.accessible !== false).length,
    evidence,
  };
}

function mapEvidenceRow(row, accessible = true) {
  return {
    id: row.id,
    profileItemId: row.profile_item_id,
    sourceKind: row.source_kind,
    sourceId: row.source_id,
    evidenceRole: row.evidence_role,
    observedAt: row.observed_at,
    accessible,
  };
}

async function loadEvidenceForItems(itemIds) {
  if (!itemIds.length) return new Map();
  const sql = getDb();
  const rows = await sql`
    SELECT id, profile_item_id, source_kind, source_id, evidence_role, observed_at
    FROM member_profile_evidence
    WHERE profile_item_id = ANY(${itemIds}::uuid[])
    ORDER BY observed_at DESC NULLS LAST, created_at ASC
  `;
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.profile_item_id)) map.set(r.profile_item_id, []);
    map.get(r.profile_item_id).push(r);
  }
  return map;
}

async function enrichItemsWithEvidenceAccessibility(items, user) {
  const enriched = [];
  for (const item of items) {
    const evRows = item._rawEvidence || [];
    const evidence = [];
    for (const ev of evRows) {
      const accessible = await isEvidenceSourceAccessible(ev.source_kind, ev.source_id, user);
      evidence.push(mapEvidenceRow(ev, accessible));
    }
    enriched.push(mapItemRow(item, evidence));
  }
  return enriched;
}

export async function listProfileItemsByStatus(user, studentId, status) {
  assertQualitativeAdmin(user);
  await assertQualitativeTablesReadyAsync();
  const sql = getDb();
  const rows = await sql`
    SELECT id, student_id, category, statement, epistemic_type, confidence, status,
           related_item_id, relation_type, supersedes_id,
           first_observed_at, last_observed_at, analysis_run_id,
           reviewed_by, reviewed_at, created_at, updated_at
    FROM member_profile_items
    WHERE student_id = ${studentId}::uuid
      AND status = ${status}
    ORDER BY last_observed_at DESC NULLS LAST, created_at DESC
  `;
  const ids = rows.map((r) => r.id);
  const evMap = await loadEvidenceForItems(ids);
  const withRaw = rows.map((r) => ({ ...r, _rawEvidence: evMap.get(r.id) || [] }));
  return enrichItemsWithEvidenceAccessibility(withRaw, user);
}

/** confirmed かつ現在参照可能 evidence が1件以上ある項目のみ */
export async function getCurrentQualitativeProfile(user, studentId) {
  const items = await listProfileItemsByStatus(user, studentId, 'confirmed');
  return items.filter((item) =>
    (item.evidence || []).some((ev) => ev.accessible !== false),
  );
}

export async function listQualitativeCandidates(user, studentId) {
  return listProfileItemsByStatus(user, studentId, 'candidate');
}

export async function listAnalysisRuns(user, studentId, limit = 30) {
  assertQualitativeAdmin(user);
  await assertQualitativeTablesReadyAsync();
  const sql = getDb();
  const workerReady = await isWorkerColumnsReady();
  const rows = workerReady
    ? await sql`
        SELECT id, student_id, window_start, window_end,
               source_count, daily_report_count, knowledge_record_count,
               psych_assessment_id, model_provider, model_name, prompt_version,
               status, created_candidates, input_fingerprint, error_text,
               worker_id, claim_token, claimed_at, lease_expires_at, attempt_count,
               started_at, completed_at, created_at
        FROM member_analysis_runs
        WHERE student_id = ${studentId}::uuid
        ORDER BY created_at DESC
        LIMIT ${limit}
      `
    : await sql`
        SELECT id, student_id, window_start, window_end,
               source_count, daily_report_count, knowledge_record_count,
               psych_assessment_id, model_provider, model_name, prompt_version,
               status, created_candidates, input_fingerprint, error_text,
               started_at, completed_at, created_at
        FROM member_analysis_runs
        WHERE student_id = ${studentId}::uuid
        ORDER BY created_at DESC
        LIMIT ${limit}
      `;
  return rows.map((r) => ({
    id: r.id,
    studentId: r.student_id,
    windowStart: r.window_start,
    windowEnd: r.window_end,
    sourceCount: r.source_count,
    dailyReportCount: r.daily_report_count,
    knowledgeRecordCount: r.knowledge_record_count,
    psychAssessmentId: r.psych_assessment_id,
    modelProvider: r.model_provider,
    modelName: r.model_name,
    promptVersion: r.prompt_version,
    status: r.status,
    createdCandidates: r.created_candidates,
    inputFingerprint: r.input_fingerprint,
    errorText: r.error_text,
    workerId: r.worker_id || null,
    claimToken: r.claim_token || null,
    claimedAt: r.claimed_at || null,
    leaseExpiresAt: r.lease_expires_at || null,
    attemptCount: r.attempt_count ?? 0,
    startedAt: r.started_at,
    completedAt: r.completed_at,
    createdAt: r.created_at,
  }));
}

export async function getLatestPsychAssessmentForStudent(studentId) {
  const rows = await listPsychAssessments({ studentId });
  return rows[0] ? mapPsychAssessmentForClient(rows[0]) : null;
}

async function insertCandidateWithEvidence(user, studentId, runId, candidate, allowedKeys, sourceMetaByKey) {
  const validation = validateAiOutput({ candidates: [candidate] }, allowedKeys, sourceMetaByKey);
  if (!validation.valid.length) {
    return { ok: false, errors: validation.rejected[0]?.errors || ['invalid candidate'] };
  }

  const c = validation.valid[0];
  const sql = getDb();
  const observedDates = (c.evidence || [])
    .map((ev) => ev.observed_at)
    .filter(Boolean);

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

export async function runQualitativeAnalysis(user, studentId, windowInput = {}) {
  assertQualitativeAdmin(user);
  await assertQualitativeTablesReadyAsync();
  const provider = assertAiProviderReadyForAnalysis();
  if (!studentId) throw Object.assign(new Error('student_id は必須です'), { status: 400 });

  if (isQueueBasedProvider(provider)) {
    const queued = await enqueueLocalWorkerAnalysis(user, studentId, windowInput);
    return { ...queued, httpStatus: 202 };
  }

  const window = parseAnalysisWindow(windowInput);
  const sql = getDb();

  const runRows = await sql`
    INSERT INTO member_analysis_runs (
      student_id, window_start, window_end, prompt_version, status, started_at
    ) VALUES (
      ${studentId},
      ${window.windowStart},
      ${window.windowEnd},
      ${QUALITATIVE_PROMPT_VERSION},
      'running',
      NOW()
    )
    RETURNING id
  `;
  const runId = runRows[0].id;

  try {
    assertSyncAiProviderForExecution();
    const { sources, allowedSourceIds, dailyReportCount, knowledgeRecordCount, sourceCount } =
      await fetchAnalysisSourcesForStudent(user, studentId, window);

    const allowedKeys = buildAllowedSourceIdSet(sources);
    const sourceMetaByKey = buildSourceMetaMap(sources);
    const fingerprint = fingerprintSources(sources);

    const confirmed = await listProfileItemsByStatus(user, studentId, 'confirmed');
    const psych = await getLatestPsychAssessmentForStudent(studentId);

    const aiResult = await runQualitativeAiAnalysis({
      sources: formatSourcesForAiPrompt(sources),
      existingProfile: confirmed.map((i) => ({
        id: i.id,
        category: i.category,
        statement: i.statement,
        epistemic_type: i.epistemicType,
      })),
      psychScores: psych?.scores || null,
    });

    const output = aiResult.step2 || aiResult;
    const { valid, rejected } = validateAiOutput(
      { candidates: output.candidates || output.observations || [] },
      allowedKeys,
      sourceMetaByKey,
    );

    let created = 0;
    for (const c of valid) {
      const ins = await insertCandidateWithEvidence(user, studentId, runId, c, allowedKeys, sourceMetaByKey);
      if (ins.ok) created += 1;
    }

    await sql`
      UPDATE member_analysis_runs SET
        source_count = ${sourceCount},
        daily_report_count = ${dailyReportCount},
        knowledge_record_count = ${knowledgeRecordCount},
        psych_assessment_id = ${psych?.id || null},
        model_provider = ${aiResult.model_provider || 'mock'},
        model_name = ${aiResult.model_name || null},
        status = 'completed',
        created_candidates = ${created},
        input_fingerprint = ${fingerprint},
        completed_at = NOW()
      WHERE id = ${runId}
    `;

    return {
      runId,
      status: 'completed',
      createdCandidates: created,
      rejectedCount: rejected.length,
      sourceCount,
      dailyReportCount,
      knowledgeRecordCount,
    };
  } catch (e) {
    await sql`
      UPDATE member_analysis_runs SET
        status = 'failed',
        error_text = ${String(e.message || 'Analysis failed').slice(0, 2000)},
        completed_at = NOW()
      WHERE id = ${runId}
    `;
    throw e;
  }
}

export async function reviewQualitativeItem(user, body = {}) {
  assertQualitativeAdmin(user);
  await assertQualitativeTablesReadyAsync();
  const itemId = String(body.item_id || body.itemId || '').trim();
  const action = String(body.action || '').trim();
  if (!itemId) throw Object.assign(new Error('item_id は必須です'), { status: 400 });
  if (!['confirm', 'reject', 'confirm_edit'].includes(action)) {
    throw Object.assign(new Error('action は confirm / reject / confirm_edit'), { status: 400 });
  }

  const sql = getDb();
  const rows = await sql`
    SELECT * FROM member_profile_items WHERE id = ${itemId} LIMIT 1
  `;
  const item = rows[0];
  if (!item) throw Object.assign(new Error('Item not found'), { status: 404 });
  if (item.status !== 'candidate') {
    throw Object.assign(new Error('candidate のみ review 可能です'), { status: 400 });
  }

  if (action === 'reject') {
    await sql`
      UPDATE member_profile_items SET
        status = 'rejected',
        reviewed_by = ${user.email || null},
        reviewed_at = NOW()
      WHERE id = ${itemId}
    `;
    return { ok: true, status: 'rejected' };
  }

  const category = body.category ? String(body.category).trim() : item.category;
  const statement = body.statement ? String(body.statement).trim() : item.statement;
  const epistemicType = body.epistemic_type || body.epistemicType || item.epistemic_type;
  const confidence = body.confidence || item.confidence;
  const supersedesId = body.supersedes_id || body.supersedesId || null;

  if (!VALID_CATEGORIES.includes(category)) {
    throw Object.assign(new Error('category が不正です'), { status: 400 });
  }
  if (!VALID_EPISTEMIC_TYPES.includes(epistemicType)) {
    throw Object.assign(new Error('epistemic_type が不正です'), { status: 400 });
  }
  if (!CONFIDENCE_LEVELS.includes(confidence)) {
    throw Object.assign(new Error('confidence が不正です'), { status: 400 });
  }
  if (!statement) throw Object.assign(new Error('statement は必須です'), { status: 400 });

  if (epistemicType === 'self_report') {
    const evRows = await sql`
      SELECT source_kind, source_id FROM member_profile_evidence
      WHERE profile_item_id = ${itemId}::uuid
    `;
    const sourceMetaByKey = new Map();
    for (const ev of evRows) {
      if (ev.source_kind === 'daily_report') {
        sourceMetaByKey.set(`${ev.source_kind}:${ev.source_id}`, { sourceKind: 'daily_report' });
        continue;
      }
      if (ev.source_kind === 'knowledge_record') {
        const kr = await sql`
          SELECT record_type FROM knowledge_records WHERE id = ${ev.source_id} LIMIT 1
        `;
        sourceMetaByKey.set(`${ev.source_kind}:${ev.source_id}`, {
          sourceKind: 'knowledge_record',
          sourceType: kr[0]?.record_type || 'other',
        });
      }
    }
    const prov = validateSelfReportProvenance(epistemicType, evRows, sourceMetaByKey);
    if (!prov.ok) {
      throw Object.assign(new Error(prov.errors[0] || 'self_report provenance invalid'), { status: 400 });
    }
  }

  await sql`
    UPDATE member_profile_items SET
      category = ${category},
      statement = ${statement},
      epistemic_type = ${epistemicType},
      confidence = ${confidence},
      status = 'confirmed',
      supersedes_id = ${supersedesId},
      reviewed_by = ${user.email || null},
      reviewed_at = NOW()
    WHERE id = ${itemId}
  `;

  if (supersedesId) {
    await sql`
      UPDATE member_profile_items SET status = 'superseded'
      WHERE id = ${supersedesId} AND student_id = ${item.student_id}
    `;
  }

  return { ok: true, status: 'confirmed', itemId };
}

export async function getEvidenceDetailForItem(user, itemId) {
  assertQualitativeAdmin(user);
  await assertQualitativeTablesReadyAsync();
  const sql = getDb();
  const evRows = await sql`
    SELECT id, profile_item_id, source_kind, source_id, evidence_role, observed_at
    FROM member_profile_evidence
    WHERE profile_item_id = ${itemId}::uuid
    ORDER BY observed_at DESC NULLS LAST
  `;

  const details = [];
  for (const ev of evRows) {
    const accessible = await isEvidenceSourceAccessible(ev.source_kind, ev.source_id, user);
    if (!accessible) {
      details.push({
        sourceKind: ev.source_kind,
        sourceId: ev.source_id,
        evidenceRole: ev.evidence_role,
        accessible: false,
        message: 'この根拠は現在、研究室知見として参照できません',
      });
      continue;
    }

    if (ev.source_kind === 'daily_report') {
      const dr = await sql`
        SELECT id, report_date, student_id, student_name, visibility,
               did_today, went_well, stuck_points, next_action, related_project, session_key, created_at
        FROM daily_reports WHERE id = ${ev.source_id} LIMIT 1
      `;
      const row = dr[0];
      if (!row || !isDailyReportEligibleForKnowledge(row)) {
        details.push({
          sourceKind: ev.source_kind,
          sourceId: ev.source_id,
          accessible: false,
          message: 'この根拠は現在、研究室知見として参照できません',
        });
        continue;
      }
      const vm = mapDailyReportToKnowledgeSource(row);
      details.push({
        sourceKind: ev.source_kind,
        sourceId: ev.source_id,
        evidenceRole: ev.evidence_role,
        accessible: true,
        title: vm.title,
        occurredAt: vm.occurredAt,
        sourceType: 'daily_report',
        bodyText: vm.bodyText,
      });
    } else {
      const kr = await sql`
        SELECT id, record_type, title, occurred_at, session_key, body_text, visibility,
               summary_text, decisions_text, next_actions_text, created_at, updated_at, created_by
        FROM knowledge_records WHERE id = ${ev.source_id} LIMIT 1
      `;
      const row = kr[0];
      if (!row || !canViewKnowledgeRecord(user, row)) {
        details.push({
          sourceKind: ev.source_kind,
          sourceId: ev.source_id,
          accessible: false,
          message: 'この根拠は現在、研究室知見として参照できません',
        });
        continue;
      }
      const parts = await loadParticipantsForRecords(sql, [row.id]);
      const vm = mapKnowledgeRecordToSource(mapKnowledgeRecordRow(row, parts.get(row.id) || []));
      details.push({
        sourceKind: ev.source_kind,
        sourceId: ev.source_id,
        evidenceRole: ev.evidence_role,
        accessible: true,
        title: vm.title,
        occurredAt: vm.occurredAt,
        sourceType: vm.sourceType,
        bodyText: vm.bodyText,
      });
    }
  }

  return details;
}

/** テスト用: AI が confirmed を作れないこと */
export function assertAiCannotConfirm(status) {
  return status === 'candidate';
}

/** テスト用: profile item + evidence accessibility filter */
export function filterCurrentProfileItems(items) {
  return (items || []).filter((item) =>
    item.status === 'confirmed'
    && (item.evidence || []).some((ev) => ev.accessible !== false),
  );
}

export {
  validateAiOutput,
  buildAllowedSourceIdSet,
  buildSourceMetaMap,
  sourceKey,
  filterAccessibleEvidence,
};
