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

/** auth 照合用: 保存済み email と Google 返却 email の一致判定（trim + lowercase のみ）。 */
export function studentEmailsMatch(stored, incoming) {
  const a = String(stored || '').trim().toLowerCase();
  const b = String(incoming || '').trim().toLowerCase();
  if (!a || !b) return false;
  return a === b;
}
