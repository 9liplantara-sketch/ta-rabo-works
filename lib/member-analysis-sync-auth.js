/** GAS → Vercel sync 用 secret ヘッダー認証 */

import { timingSafeEqual } from 'node:crypto';

export const MEMBER_ANALYSIS_SECRET_HEADER = 'x-member-analysis-secret';

export function getMemberAnalysisSyncSecret() {
  return String(process.env.MEMBER_ANALYSIS_SYNC_SECRET || '').trim();
}

/**
 * @param {string|undefined|null} providedSecret
 * @returns {{ ok: true } | { ok: false, status: number, error: string }}
 */
export function verifySyncSecret(providedSecret) {
  const expectedSecret = process.env.MEMBER_ANALYSIS_SYNC_SECRET;

  if (!expectedSecret || !String(expectedSecret).trim()) {
    return {
      ok: false,
      status: 503,
      error: 'sync_secret_not_configured',
    };
  }

  if (providedSecret === undefined || providedSecret === null || !String(providedSecret).trim()) {
    return {
      ok: false,
      status: 401,
      error: 'unauthorized',
    };
  }

  const provided = Buffer.from(String(providedSecret).trim());
  const expected = Buffer.from(String(expectedSecret).trim());

  if (provided.length !== expected.length) {
    return {
      ok: false,
      status: 401,
      error: 'unauthorized',
    };
  }

  if (!timingSafeEqual(provided, expected)) {
    return {
      ok: false,
      status: 401,
      error: 'unauthorized',
    };
  }

  return { ok: true };
}

export function requireMemberAnalysisSyncSecret(req, res) {
  const result = verifySyncSecret(req.headers[MEMBER_ANALYSIS_SECRET_HEADER]);
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return false;
  }
  return true;
}
