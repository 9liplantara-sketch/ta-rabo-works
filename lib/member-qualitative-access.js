/**
 * Phase M3 — 定性プロフィールは admin only（server-side 必須）
 *
 * UI 非表示だけでは不十分。すべての qualitative API はこの layer を通ること。
 * student / 未ログイン / 外部ユーザーは 401 / 403。
 */

export function canAccessQualitativeProfile(user) {
  return !!user && user.role === 'admin';
}

export function assertQualitativeAdmin(user) {
  if (!user) {
    const err = new Error('Unauthorized');
    err.status = 401;
    throw err;
  }
  if (!canAccessQualitativeProfile(user)) {
    const err = new Error('Forbidden: admin only');
    err.status = 403;
    throw err;
  }
}
