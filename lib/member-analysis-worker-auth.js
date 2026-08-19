/** Local Worker → Vercel API 専用 secret 認証（sync secret とは別） */

import { timingSafeEqual } from 'node:crypto';

export const MEMBER_ANALYSIS_WORKER_SECRET_HEADER = 'x-member-analysis-worker-secret';

export function getMemberAnalysisWorkerSecret() {
  return String(process.env.MEMBER_ANALYSIS_WORKER_SECRET || '').trim();
}

/**
 * @param {string|undefined|null} providedSecret
 * @returns {{ ok: true } | { ok: false, status: number, error: string }}
 */
export function verifyWorkerSecret(providedSecret) {
  const expectedSecret = process.env.MEMBER_ANALYSIS_WORKER_SECRET;

  if (!expectedSecret || !String(expectedSecret).trim()) {
    return {
      ok: false,
      status: 503,
      error: 'worker_secret_not_configured',
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

export function requireMemberAnalysisWorkerSecret(req, res) {
  const header = req.headers[MEMBER_ANALYSIS_WORKER_SECRET_HEADER]
    || req.headers[MEMBER_ANALYSIS_WORKER_SECRET_HEADER.toLowerCase()];
  const result = verifyWorkerSecret(header);
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return false;
  }
  return true;
}
