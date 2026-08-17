/**
 * Phase M3 — evidence の現在アクセス可否（privacy 変更の伝播）
 *
 * evidence には source 本文をコピーしない。参照時に正本の accessibility を確認する。
 */

import { getDb } from './db.js';
import {
  isDailyReportEligibleForKnowledge,
} from './knowledge-access.js';
import { canViewKnowledgeRecord } from './knowledge-access.js';

/** admin AI 分析 / プロフィール表示用: daily_report が現在参照可能か */
export async function isDailyReportSourceAccessible(sourceId, user) {
  if (!sourceId || !user) return false;
  const sql = getDb();
  const rows = await sql`
    SELECT id, visibility
    FROM daily_reports
    WHERE id = ${sourceId}
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return false;
  return isDailyReportEligibleForKnowledge(row);
}

/** admin AI 分析 / プロフィール表示用: knowledge_record が現在参照可能か */
export async function isKnowledgeRecordSourceAccessible(sourceId, user) {
  if (!sourceId || !user) return false;
  const sql = getDb();
  const rows = await sql`
    SELECT id, visibility
    FROM knowledge_records
    WHERE id = ${sourceId}
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return false;
  return canViewKnowledgeRecord(user, row);
}

export async function isEvidenceSourceAccessible(sourceKind, sourceId, user) {
  if (sourceKind === 'daily_report') {
    return isDailyReportSourceAccessible(sourceId, user);
  }
  if (sourceKind === 'knowledge_record') {
    return isKnowledgeRecordSourceAccessible(sourceId, user);
  }
  return false;
}

export async function filterAccessibleEvidence(evidenceRows, user) {
  const out = [];
  for (const ev of evidenceRows || []) {
    const ok = await isEvidenceSourceAccessible(ev.source_kind, ev.source_id, user);
    if (ok) out.push(ev);
  }
  return out;
}

/** テスト用: in-memory visibility チェック */
export function isDailyReportRowAccessible(row) {
  return isDailyReportEligibleForKnowledge(row);
}

export function partitionEvidenceByAccessibility(evidenceList, dailyReportMap, knowledgeRecordMap, user) {
  const accessible = [];
  const inaccessible = [];
  for (const ev of evidenceList || []) {
    let ok = false;
    if (ev.source_kind === 'daily_report') {
      ok = isDailyReportEligibleForKnowledge(dailyReportMap.get(String(ev.source_id)));
    } else if (ev.source_kind === 'knowledge_record') {
      const rec = knowledgeRecordMap.get(String(ev.source_id));
      ok = canViewKnowledgeRecord(user, rec);
    }
    if (ok) accessible.push(ev);
    else inaccessible.push(ev);
  }
  return { accessible, inaccessible };
}
