/** 学生ライフサイクル（登録 · ログイン許可 · 在籍）— contract test / API / DB 共用 */

export const STUDENT_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** API/DB 共通: 任意 email の trim + lowercase。空欄は null。 */
export function normalizeOptionalStudentEmail(email) {
  const v = String(email || '').trim().toLowerCase();
  if (!v) return { ok: true, value: null };
  if (!STUDENT_EMAIL_RE.test(v)) return { ok: false };
  return { ok: true, value: v };
}

/** createStudent 用: メール未設定なら login_enabled は必ず false。 */
export function resolveCreateLoginEnabled(normalizedEmail, loginEnabled) {
  return normalizedEmail ? Boolean(loginEnabled) : false;
}

/**
 * 必須 email 正規化。normalizeOptionalStudentEmail と同じ trim+lowercase だが null を返さない。
 * 空/不正なら { ok: false }。
 */
export function normalizeStudentEmail(email) {
  const v = String(email || '').trim().toLowerCase();
  if (!v) return { ok: false };
  if (!STUDENT_EMAIL_RE.test(v)) return { ok: false };
  return { ok: true, value: v };
}

/**
 * students 配列から normalized email の重複を検出する。
 * excludeId を指定すると自分自身を除外（update 時用）。
 * @returns {boolean} true なら重複あり
 */
export function hasNormalizedEmailDuplicate(students, email, excludeId = null) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) return false;
  return (students || []).some((s) => {
    if (excludeId && String(s.id) === String(excludeId)) return false;
    const se = s.email ? String(s.email).trim().toLowerCase() : null;
    return se === normalized;
  });
}

/** auth 照合用: 保存済み email と Google 返却 email の一致判定（trim + lowercase のみ）。 */
export function studentEmailsMatch(stored, incoming) {
  const a = String(stored || '').trim().toLowerCase();
  const b = String(incoming || '').trim().toLowerCase();
  if (!a || !b) return false;
  return a === b;
}
