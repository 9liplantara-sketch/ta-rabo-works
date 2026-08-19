/**
 * 研究室の知見 — unified RECORDS/SOURCES feed
 *
 * daily_reports はコピーせず visibility IN ('lab','public') のみ動的参照。
 * 将来 AI も listKnowledgeSources() 経由でのみ取得すること。
 */

import { getDb } from './db.js';
import { toIlikePattern, parseDateParam } from './daily-reports.js';
import {
  isDailyReportEligibleForKnowledge,
  canViewKnowledgeRecord,
  canUseSourceForKnowledge,
} from './knowledge-access.js';
import {
  listKnowledgeRecordsForFeed,
  parseKnowledgeListParams,
  KNOWLEDGE_RECORD_TYPES,
  isKnowledgeRecordsTableReady,
} from './knowledge-records.js';

export { parseKnowledgeListParams, KNOWLEDGE_RECORD_TYPES };

const BODY_EXCERPT_LEN = 280;

export function buildDailyReportBodyText(row) {
  const sections = [];
  const add = (label, value) => {
    const s = String(value ?? '').trim();
    if (s) sections.push(`${label}\n${s}`);
  };
  add('今日やったこと', row.did_today);
  add('うまくいったこと', row.went_well);
  add('困っていること', row.stuck_points);
  add('次にやること', row.next_action);
  add('関連プロジェクト', row.related_project);
  return sections.join('\n\n');
}

export function buildDailyReportTitle(row) {
  const name = String(row.student_name || '').trim() || '学生';
  return `${name}の日報`;
}

export function excerptText(text, maxLen = BODY_EXCERPT_LEN) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  if (s.length <= maxLen) return s;
  return `${s.slice(0, maxLen)}…`;
}

/** daily_report 行 → unified ViewModel（private は呼び出し前に除外すること） */
export function mapDailyReportToKnowledgeSource(row) {
  if (!row || !isDailyReportEligibleForKnowledge(row)) return null;
  const bodyText = buildDailyReportBodyText(row);
  const occurredAt = row.report_date
    ? `${row.report_date}T00:00:00.000Z`
    : (row.created_at || new Date().toISOString());
  return {
    id: `daily_report:${row.id}`,
    sourceKind: 'daily_report',
    sourceType: 'daily_report',
    sourceId: String(row.id),
    title: buildDailyReportTitle(row),
    occurredAt,
    bodyText,
    bodyExcerpt: excerptText(bodyText),
    summaryText: null,
    decisionsText: null,
    nextActionsText: null,
    sessionKey: row.session_key ?? null,
    participants: row.student_id || row.student_name
      ? [{ studentId: row.student_id || null, name: row.student_name }]
      : [],
    visibility: row.visibility,
    editable: false,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : (row.created_at ? new Date(row.created_at).toISOString() : null),
  };
}

/** knowledge_record → unified ViewModel */
export function mapKnowledgeRecordToSource(record) {
  if (!record) return null;
  return {
    id: `record:${record.id}`,
    sourceKind: 'knowledge_record',
    sourceType: record.record_type,
    sourceId: String(record.id),
    title: record.title,
    occurredAt: record.occurred_at,
    bodyText: record.body_text,
    bodyExcerpt: excerptText(record.body_text),
    summaryText: record.summary_text ?? null,
    decisionsText: record.decisions_text ?? null,
    nextActionsText: record.next_actions_text ?? null,
    sessionKey: record.session_key ?? null,
    participants: (record.participants || []).map((p) => ({
      studentId: p.studentId || p.student_id || null,
      name: p.name || p.participant_name,
    })),
    visibility: record.visibility,
    editable: true,
    createdAt: record.created_at ? new Date(record.created_at).toISOString() : null,
    updatedAt: record.updated_at ? new Date(record.updated_at).toISOString() : null,
  };
}

export async function listShareableDailyReportsForKnowledge(params) {
  const sql = getDb();
  const { limit, q, studentId, sessionKey, from, to } = params;
  const qPattern = toIlikePattern(q);

  const rows = await sql`
    SELECT id, report_date, student_id, student_name,
           did_today, went_well, stuck_points, next_action, related_project, session_key,
           visibility, created_at
    FROM daily_reports
    WHERE visibility IN ('lab', 'public')
      AND (${studentId}::uuid IS NULL OR student_id = ${studentId}::uuid)
      AND (${sessionKey}::text IS NULL OR session_key = ${sessionKey})
      AND (${from}::date IS NULL OR report_date >= ${from}::date)
      AND (${to}::date IS NULL OR report_date <= ${to}::date)
      AND (${qPattern}::text IS NULL OR (
        student_name ILIKE ${qPattern} ESCAPE '\\'
        OR did_today ILIKE ${qPattern} ESCAPE '\\'
        OR went_well ILIKE ${qPattern} ESCAPE '\\'
        OR stuck_points ILIKE ${qPattern} ESCAPE '\\'
        OR next_action ILIKE ${qPattern} ESCAPE '\\'
        OR related_project ILIKE ${qPattern} ESCAPE '\\'
      ))
    ORDER BY report_date DESC, created_at DESC
    LIMIT ${limit}
  `;

  return rows.map(mapDailyReportToKnowledgeSource).filter(Boolean);
}

function compareOccurredAt(a, b) {
  const ta = new Date(a).getTime();
  const tb = new Date(b).getTime();
  return tb - ta;
}

/**
 * knowledge_records + 共有可能 daily_reports の unified feed
 * private 日報は SQL 層で除外（admin でも例外なし）
 */
export async function listKnowledgeSources(user, query = {}) {
  const params = parseKnowledgeListParams(query);
  const { limit, offset, recordType } = params;

  const fetchN = limit + offset + 1;
  const fetchParams = { ...params, limit: fetchN };

  const includeDailyReports = !recordType || recordType === 'daily_report';
  const tableReady = await isKnowledgeRecordsTableReady();

  const [records, reports] = await Promise.all([
    tableReady
      ? listKnowledgeRecordsForFeed(user, fetchParams)
      : Promise.resolve([]),
    includeDailyReports
      ? listShareableDailyReportsForKnowledge(fetchParams)
      : Promise.resolve([]),
  ]);

  let sources = [
    ...records.map(mapKnowledgeRecordToSource),
    ...reports,
  ].filter(Boolean);

  sources = sources.filter((s) => canUseSourceForKnowledge(user, s));
  sources.sort((a, b) => compareOccurredAt(a.occurredAt, b.occurredAt));

  const hasMore = sources.length > offset + limit;
  const page = sources.slice(offset, offset + limit);

  return {
    sources: page,
    limit,
    offset,
    has_more: hasMore,
    knowledge_records_ready: tableReady,
  };
}

/** テスト用: in-memory rows から private 除外を検証 */
export function filterDailyReportsForKnowledgeFeed(rows) {
  return (rows || [])
    .filter(isDailyReportEligibleForKnowledge)
    .map(mapDailyReportToKnowledgeSource)
    .filter(Boolean);
}

/** record_type ラベル（UI 用） */
export function getSourceTypeLabel(sourceType) {
  if (sourceType === 'daily_report') return '日報';
  return KNOWLEDGE_RECORD_TYPES[sourceType] || sourceType || '記録';
}

export function filterSourcesVisibleToUser(user, sources) {
  return (sources || []).filter((s) => canUseSourceForKnowledge(user, s));
}

export function filterKnowledgeRecordsVisibleToUser(user, records) {
  return (records || []).filter((r) => canViewKnowledgeRecord(user, r));
}
