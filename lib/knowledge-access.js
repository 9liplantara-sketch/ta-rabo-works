/**
 * 研究室の知見 — アクセス制御（server-side · UI/将来AI 共通）
 *
 * 重要: 将来 AI がデータを取得する際も、この layer を経由すること。
 * `SELECT * FROM daily_reports` を直接 AI へ渡さないこと。
 * private 日報は知見・AI 分析の対象外（admin でも例外なし）。
 */

export const KNOWLEDGE_ELIGIBLE_DAILY_VISIBILITIES = ['lab', 'public'];

export const KNOWLEDGE_RECORD_VISIBILITY = ['lab', 'admin'];

/** 日報が研究室の知見 feed に載せられるか（private は絶対除外） */
export function isDailyReportEligibleForKnowledge(row) {
  if (!row) return false;
  return KNOWLEDGE_ELIGIBLE_DAILY_VISIBILITIES.includes(String(row.visibility || '').toLowerCase());
}

/** knowledge_records の閲覧権限 */
export function canViewKnowledgeRecord(user, record) {
  if (!user || !record) return false;
  const vis = String(record.visibility || 'lab').toLowerCase();
  if (vis === 'admin') return user.role === 'admin';
  return true;
}

/** unified source ViewModel の閲覧可否 */
export function canUseSourceForKnowledge(user, source) {
  if (!user || !source) return false;
  if (source.sourceKind === 'daily_report') {
    return isDailyReportEligibleForKnowledge(source);
  }
  if (source.sourceKind === 'knowledge_record') {
    return canViewKnowledgeRecord(user, source);
  }
  return false;
}

/** manual record の write 権限 */
export function canWriteKnowledgeRecord(user) {
  return !!user && user.role === 'admin';
}
