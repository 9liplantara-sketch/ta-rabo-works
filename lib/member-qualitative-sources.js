/**
 * Phase M3 — AI分析入力ソース取得
 *
 * 必ず Knowledge Access Layer 経由。private daily_report は絶対除外。
 */

import { getDb } from './db.js';
import {
  listShareableDailyReportsForKnowledge,
  mapDailyReportToKnowledgeSource,
  mapKnowledgeRecordToSource,
  buildDailyReportBodyText,
} from './knowledge-sources.js';
import { isKnowledgeRecordsTableReady, loadParticipantsForRecords } from './knowledge-records.js';
import { mapKnowledgeRecordRow } from './knowledge-records.js';
import { canViewKnowledgeRecord } from './knowledge-access.js';
import { isDailyReportEligibleForKnowledge } from './knowledge-access.js';

const ANALYSIS_SOURCE_LIMIT = 200;

export function parseAnalysisWindow(body = {}, query = {}) {
  const now = new Date();
  const endRaw = body.window_end ?? body.windowEnd ?? query.window_end ?? query.to;
  const startRaw = body.window_start ?? body.windowStart ?? query.window_start ?? query.from;

  let windowEnd = endRaw ? new Date(String(endRaw)) : now;
  if (Number.isNaN(windowEnd.getTime())) windowEnd = now;

  let windowStart;
  if (startRaw) {
    windowStart = new Date(String(startRaw));
    if (Number.isNaN(windowStart.getTime())) {
      windowStart = new Date(windowEnd);
      windowStart.setDate(windowStart.getDate() - 6);
    }
  } else {
    windowStart = new Date(windowEnd);
    windowStart.setDate(windowStart.getDate() - 6);
    windowStart.setHours(0, 0, 0, 0);
  }

  windowEnd.setHours(23, 59, 59, 999);

  return {
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
    fromDate: windowStart.toISOString().slice(0, 10),
    toDate: windowEnd.toISOString().slice(0, 10),
  };
}

export async function listKnowledgeRecordsForStudentAnalysis(user, studentId, fromDate, toDate) {
  if (!studentId) return [];
  const ready = await isKnowledgeRecordsTableReady();
  if (!ready) return [];

  const sql = getDb();
  const rows = await sql`
    SELECT DISTINCT kr.id, kr.record_type, kr.title, kr.occurred_at, kr.session_key,
           kr.body_text, kr.summary_text, kr.decisions_text, kr.next_actions_text,
           kr.visibility, kr.created_by, kr.created_at, kr.updated_at
    FROM knowledge_records kr
    INNER JOIN knowledge_record_participants krp ON krp.record_id = kr.id
    WHERE krp.student_id = ${studentId}::uuid
      AND kr.occurred_at >= ${fromDate}::date
      AND kr.occurred_at < (${toDate}::date + INTERVAL '1 day')
    ORDER BY kr.occurred_at DESC
    LIMIT ${ANALYSIS_SOURCE_LIMIT}
  `;

  const ids = rows.map((r) => r.id);
  const partMap = await loadParticipantsForRecords(sql, ids);
  return rows
    .map((r) => mapKnowledgeRecordRow(r, partMap.get(r.id) || []))
    .filter((r) => canViewKnowledgeRecord(user, r))
    .map(mapKnowledgeRecordToSource)
    .filter(Boolean);
}

/**
 * 指定期間の分析ソース（admin AI 用）
 * @returns {{ sources, allowedSourceIds: Set<string>, dailyReportCount, knowledgeRecordCount }}
 */
export async function fetchAnalysisSourcesForStudent(user, studentId, window) {
  const { fromDate, toDate } = window;

  const reports = await listShareableDailyReportsForKnowledge({
    studentId,
    from: fromDate,
    to: toDate,
    limit: ANALYSIS_SOURCE_LIMIT,
    q: '',
    sessionKey: null,
  });

  const records = await listKnowledgeRecordsForStudentAnalysis(user, studentId, fromDate, toDate);

  const sources = [...reports, ...records];
  const allowedSourceIds = new Set();
  for (const s of sources) {
    allowedSourceIds.add(`${s.sourceKind}:${s.sourceId}`);
  }

  return {
    sources,
    allowedSourceIds,
    dailyReportCount: reports.length,
    knowledgeRecordCount: records.length,
    sourceCount: sources.length,
  };
}

/** テスト用: in-memory rows から private 除外 */
export function filterDailyReportsForAnalysis(rows) {
  return (rows || []).filter(isDailyReportEligibleForKnowledge);
}

export function buildAllowedSourceIdSet(sources) {
  const set = new Set();
  for (const s of sources || []) {
    if (s.sourceKind && s.sourceId) set.add(`${s.sourceKind}:${s.sourceId}`);
  }
  return set;
}

export function sourceKey(sourceKind, sourceId) {
  return `${sourceKind}:${sourceId}`;
}

export function formatSourcesForAiPrompt(sources) {
  return (sources || []).map((s) => ({
    source_kind: s.sourceKind,
    source_id: s.sourceId,
    source_type: s.sourceType,
    title: s.title,
    occurred_at: s.occurredAt,
    body_text: s.bodyText,
  }));
}

/** validateAiCandidate の self_report provenance 用 */
export function buildSourceMetaMap(sources) {
  const map = new Map();
  for (const s of sources || []) {
    if (!s.sourceKind || !s.sourceId) continue;
    map.set(`${s.sourceKind}:${s.sourceId}`, {
      sourceKind: s.sourceKind,
      sourceType: s.sourceType,
    });
  }
  return map;
}

export { buildDailyReportBodyText, isDailyReportEligibleForKnowledge };
