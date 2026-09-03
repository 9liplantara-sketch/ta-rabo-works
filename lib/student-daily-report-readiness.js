import { getPublicDisplayName, isStudentLoginAllowed } from './auth.js';

/**
 * 日報(POST /api/daily-reports) のうち「学生 identity / role / DB constraints」
 * で失敗しうるかを判定するための純粋 helper。
 *
 * 注意:
 * - runtime は getDb() + SQL で student を引くが、本 helper は students 配列を受け取って同等に解決する
 * - daily_reports の INSERT の前提となる必須 identity を主に判定し、did_today/report_date 等の body は既定で VALID とみなす
 *
 * エラーの返却スタイル:
 * - ready: false の場合、httpStatus / errorCode / reasons を同時に返す（UI 連携用）
 */

function normalizeEmail(input) {
  const v = String(input || '').trim().toLowerCase();
  return v || null;
}

function findStudentById(students, id) {
  const sid = String(id || '').trim();
  if (!sid) return null;
  return (students || []).find((s) => String(s?.id) === sid) || null;
}

function findStudentsByEmailNormalized(students, email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return [];
  return (students || []).filter((s) => {
    const se = s?.email;
    if (se == null) return false; // runtime: findStudentByEmail は email IS NOT NULL のみにマッチ
    return String(se).trim().toLowerCase() === normalized;
  });
}

function runtimePickStudentByEmail(students, email) {
  // runtime: WHERE ... LIMIT 1（ORDER BY なし）→ 入力配列順と同様の「先頭」を採用する
  const matches = findStudentsByEmailNormalized(students, email);
  return matches[0] || null;
}

function deny(status, errorCode, message, reasons = [errorCode]) {
  return { ready: false, httpStatus: status, errorCode, message, reasons };
}

/**
 * auth/enrichUserFromDb のうち「student を見つけてログイン可能か」を再現。
 * admin は adminEmails により決定（ADMIN_EMAILS 相当）。
 */
export function enrichUserFromDbPure({ sessionUser, students, adminEmails = [], emailDuplicateMode = 'failClosed' }) {
  const admins = new Set((adminEmails || []).map((e) => String(e || '').trim().toLowerCase()).filter(Boolean));
  const isEnvAdmin = sessionUser?.email && admins.has(String(sessionUser.email).toLowerCase());

  const denyInactive = () => deny(403, 'login_disabled', 'Account not approved', ['login_disabled']);
  const denyNotFound = () => deny(403, 'student_not_found', 'Student record not found', ['student_not_found']);

  const studentId = sessionUser?.studentId ? String(sessionUser.studentId).trim() : null;
  if (studentId) {
    const byId = findStudentById(students, studentId);
    if (byId && (isEnvAdmin || isStudentLoginAllowed(byId))) {
      if (isEnvAdmin) {
        return {
          ready: true,
          user: { ...mapStudentToUser(byId), role: 'admin' },
        };
      }
      return { ready: true, user: mapStudentToUser(byId) };
    }
  }

  const byEmailCandidates = findStudentsByEmailNormalized(students, sessionUser?.email);
  if (byEmailCandidates.length > 1 && emailDuplicateMode === 'failClosed') {
    // runtime 自体は LIMIT 1 で非決定になり得るため、監査は FAIL CLOSED を推奨
    return deny(403, 'identity_ambiguous_email_duplicate', 'Duplicate normalized email', [
      'identity_ambiguous_email_duplicate',
    ]);
  }

  const byEmail = emailDuplicateMode === 'failClosed'
    ? (byEmailCandidates[0] || null)
    : runtimePickStudentByEmail(students, sessionUser?.email);

  if (byEmail) {
    if (isEnvAdmin) {
      return { ready: true, user: { ...mapStudentToUser(byEmail), role: 'admin' } };
    }
    if (!isStudentLoginAllowed(byEmail)) return denyInactive();
    return { ready: true, user: mapStudentToUser(byEmail) };
  }

  if (isEnvAdmin) {
    return {
      ready: true,
      user: {
        id: null,
        studentId: null,
        email: sessionUser.email,
        name: sessionUser.name,
        display_name: sessionUser.display_name || null,
        role: 'admin',
        is_active: true,
        login_enabled: true,
      },
    };
  }

  return denyNotFound();
}

function mapStudentToUser(student) {
  return {
    id: student.id,
    studentId: student.id,
    email: student.email,
    name: student.name,
    display_name: student.display_name,
    role: student.role,
    is_active: student.is_active,
    login_enabled: student.login_enabled,
  };
}

function resolveStudentIdentityPure({ user, students, adminEmails = [], emailDuplicateMode = 'failClosed' }) {
  // runtime: admin は null（呼び出し側で proxy 指定を処理）
  if (!user || user.role === 'admin') return { ready: true, student: null };

  const byId = user.studentId ? findStudentById(students, user.studentId) : null;
  if (byId && isStudentLoginAllowed(byId)) return { ready: true, student: byId };

  const byEmailCandidates = findStudentsByEmailNormalized(students, user.email);
  if (byEmailCandidates.length > 1 && emailDuplicateMode === 'failClosed') {
    return deny(403, 'identity_ambiguous_email_duplicate', 'Duplicate normalized email', [
      'identity_ambiguous_email_duplicate',
    ]);
  }
  const byEmail = byEmailCandidates[0] || null;
  if (byEmail && isStudentLoginAllowed(byEmail)) return { ready: true, student: byEmail };

  if (byEmail || byId) {
    return deny(403, 'login_disabled', 'Account not approved', ['login_disabled']);
  }
  return deny(403, 'student_not_found', 'Student record not found', ['student_not_found']);
}

/**
 * evaluateStudentDailyReportReadiness
 */
export function evaluateStudentDailyReportReadiness({
  authSessionUser,
  students,
  adminEmails = [],
  emailDuplicateMode = 'failClosed',
  dailyReportBody = {},
}) {
  // daily report body の必須項目（identity の監査対象から除外するため、デフォルトで VALID にする）
  const body = {
    report_date: dailyReportBody.report_date || '2026-09-03',
    did_today: dailyReportBody.did_today || 'test',
    visibility: dailyReportBody.visibility || 'private',
    session_key: dailyReportBody.session_key ?? null,
    student_email: dailyReportBody.student_email,
    student_name: dailyReportBody.student_name,
    ...dailyReportBody,
  };

  const enrich = enrichUserFromDbPure({
    sessionUser: authSessionUser,
    students,
    adminEmails,
    emailDuplicateMode,
  });
  if (!enrich.ready) return enrich;

  const user = enrich.user;

  // resolveDailyReportStudentFields（resolveStudentIdentity まで）
  let studentId = null;
  let studentEmail = null;
  let studentName = null;

  if (user.role === 'admin') {
    if (body.student_email) {
      const proxyEmail = String(body.student_email).trim().toLowerCase();
      const proxyCandidates = findStudentsByEmailNormalized(students, proxyEmail);
      if (proxyCandidates.length > 1 && emailDuplicateMode === 'failClosed') {
        return deny(403, 'identity_ambiguous_email_duplicate', 'Duplicate normalized email', [
          'identity_ambiguous_email_duplicate',
        ]);
      }
      const proxy = proxyCandidates[0] || null;
      studentEmail = proxyEmail;
      studentName = body.student_name
        ? String(body.student_name).trim()
        : (proxy ? (proxy.display_name || proxy.name) : getPublicDisplayName(user));
      studentId = proxy?.id || user.studentId || user.id || null;
    } else {
      studentName = getPublicDisplayName(user);
      studentEmail = user.email;
      studentId = user.studentId || user.id || null;
    }
  } else {
    const resolved = resolveStudentIdentityPure({ user, students, adminEmails, emailDuplicateMode });
    if (!resolved.ready) return resolved;
    const dbStudent = resolved.student;
    if (!dbStudent) {
      // runtime: resolvedStudent が null になるのは admin 時だけ（ここに到達しない想定）
      return deny(403, 'student_not_found', 'Student record not found', ['student_not_found']);
    }
    studentEmail = dbStudent.email;
    studentName = dbStudent.display_name || dbStudent.name;
    studentId = dbStudent.id;
  }

  // DB constraint (db/schema.sql: daily_reports.student_email TEXT NOT NULL, student_name TEXT NOT NULL)
  if (studentEmail == null) {
    return {
      ready: false,
      httpStatus: 500,
      errorCode: 'db_constraint_student_email_not_null',
      message: 'daily_reports.student_email is NOT NULL but resolved value was null',
      reasons: ['missing_student_email'],
    };
  }
  if (studentName == null) {
    return {
      ready: false,
      httpStatus: 500,
      errorCode: 'db_constraint_student_name_not_null',
      message: 'daily_reports.student_name is NOT NULL but resolved value was null',
      reasons: ['missing_student_name'],
    };
  }

  // identity OK
  return { ready: true, reasons: [], studentId, studentEmail, studentName };
}

/**
 * 監査向けに、学生行だけ渡して「その学生自身の token を持つ」前提で判定する。
 */
export function evaluateStudentDailyReportReadinessFromStudentRow({
  student,
  students,
  adminEmails = [],
  emailDuplicateMode = 'failClosed',
}) {
  const authSessionUser = {
    email: student.email,
    name: student.name,
    display_name: student.display_name || null,
    role: student.role,
    studentId: student.id,
  };

  return evaluateStudentDailyReportReadiness({
    authSessionUser,
    students: students || [student],
    adminEmails,
    emailDuplicateMode,
    dailyReportBody: {},
  });
}

/**
 * create/update 前のバリデーション用: まだ DB に存在しない candidate student を評価する。
 * existingStudents に candidate 自身を加えてから readiness を判定する。
 * update の場合は existingStudents から旧 row を除外して candidate を差し替えること。
 */
export function evaluateStudentDailyReportReadinessCandidate({
  candidate,
  existingStudents,
  adminEmails = [],
  emailDuplicateMode = 'failClosed',
}) {
  // candidate を含む students 配列を構築（duplicate 検出にも必要）
  const allStudents = [...(existingStudents || []), candidate];

  return evaluateStudentDailyReportReadinessFromStudentRow({
    student: candidate,
    students: allStudents,
    adminEmails,
    emailDuplicateMode,
  });
}

