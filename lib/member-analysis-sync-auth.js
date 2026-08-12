/** GAS → Vercel sync 用 secret ヘッダー認証 */

export const MEMBER_ANALYSIS_SECRET_HEADER = 'x-member-analysis-secret';

export function getMemberAnalysisSyncSecret() {
  return String(process.env.MEMBER_ANALYSIS_SYNC_SECRET || '').trim();
}

export function requireMemberAnalysisSyncSecret(req, res) {
  const expected = getMemberAnalysisSyncSecret();
  if (!expected) {
    res.status(503).json({ error: 'Member analysis sync is not configured' });
    return false;
  }
  const provided = String(req.headers[MEMBER_ANALYSIS_SECRET_HEADER] || '').trim();
  if (!provided || provided !== expected) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}
