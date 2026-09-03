import { SignJWT, jwtVerify } from 'jose';
import { findStudentByEmail } from './db.js';

const encoder = new TextEncoder();

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('JWT_SECRET must be set (32+ characters)');
  }
  return encoder.encode(secret);
}

export function getAdminEmails() {
  return (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function mapStudentToUser(student) {
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

export function getPublicDisplayName(user) {
  return String(user?.display_name || user?.name || user?.email || '').trim();
}

// students 行がログイン可能な状態か判定する。
// 承認済み = 在籍中(is_active) かつ ログイン許可(login_enabled) かつ role が admin/student。
export function isStudentLoginAllowed(student) {
  if (!student) return false;
  if (!student.is_active) return false;
  if (!student.login_enabled) return false;
  if (!['admin', 'student'].includes(student.role)) return false;
  return true;
}

export async function resolveUserFromEmail(email, nameFromGoogle) {
  const normalized = email.trim().toLowerCase();

  // 環境変数で指定された管理者（教員）は常にログイン許可（承認の起点）。
  const admins = getAdminEmails();
  if (admins.includes(normalized)) {
    // students に行があればそれを使い（role/表示名など）、無ければ env ベースの admin として扱う。
    const adminStudent = await findStudentByEmail(normalized);
    if (adminStudent && adminStudent.is_active) {
      const user = mapStudentToUser(adminStudent);
      user.role = 'admin';
      if (!user.name && nameFromGoogle) user.name = nameFromGoogle;
      return user;
    }
    return {
      id: null,
      email: normalized,
      name: nameFromGoogle || normalized,
      display_name: null,
      role: 'admin',
      is_active: true,
      login_enabled: true,
      studentId: null,
    };
  }

  // 一般ユーザーは students に登録済みかつ承認済み(login_enabled)のみログイン可能。
  // Google ログイン成功だけでは使えない。未登録・未承認は null を返す。
  const student = await findStudentByEmail(normalized);
  if (student && isStudentLoginAllowed(student)) {
    const user = mapStudentToUser(student);
    if (!user.name && nameFromGoogle) user.name = nameFromGoogle;
    return user;
  }

  return null;
}

function denyAuth(status, message, code) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  throw err;
}

/** @internal contract tests のみ — production では未使用 */
let _testStudentLookup = null;

export function __testSetStudentLookup(lookup) {
  _testStudentLookup = lookup;
}

export function __testResetStudentLookup() {
  _testStudentLookup = null;
}

async function lookupStudentById(id) {
  if (_testStudentLookup?.findById) return _testStudentLookup.findById(id);
  const { findStudentById } = await import('./db.js');
  return findStudentById(id);
}

async function lookupStudentByEmail(email) {
  if (_testStudentLookup?.findByEmail) return _testStudentLookup.findByEmail(email);
  return findStudentByEmail(email);
}

/** セッション JWT を Neon の最新 students 行で補完する。
    在籍停止(is_active=false)・ログイン許可取消(login_enabled=false)されたら 403 で弾く。
    env 管理者は承認の起点なので students 行が無くても admin として通す。 */
export async function enrichUserFromDb(sessionUser) {
  const admins = getAdminEmails();
  const isEnvAdmin = sessionUser.email && admins.includes(String(sessionUser.email).toLowerCase());

  const denyInactive = () => denyAuth(403, 'Account not approved', 'login_disabled');
  const denyNotFound = () => denyAuth(403, 'Account not approved', 'student_not_found');

  if (sessionUser.studentId) {
    const byId = await lookupStudentById(sessionUser.studentId);
    if (byId && (isEnvAdmin || isStudentLoginAllowed(byId))) {
      if (isEnvAdmin) {
        const user = mapStudentToUser(byId);
        user.role = 'admin';
        return user;
      }
      return mapStudentToUser(byId);
    }
  }

  const byEmail = await lookupStudentByEmail(sessionUser.email);
  if (byEmail) {
    if (isEnvAdmin) {
      const user = mapStudentToUser(byEmail);
      user.role = 'admin';
      return user;
    }
    if (!isStudentLoginAllowed(byEmail)) denyInactive();
    return mapStudentToUser(byEmail);
  }

  if (isEnvAdmin) {
    return {
      id: null,
      studentId: null,
      email: sessionUser.email,
      name: sessionUser.name,
      display_name: null,
      role: 'admin',
      is_active: true,
      login_enabled: true,
    };
  }
  // students に行が無く env 管理者でもない = 承認されていない。セッションを無効化する。
  denyNotFound();
}

/** 日報 CRUD 用: student 本人の students 行を session から server-side で確定する。
    admin は null を返す（呼び出し側で proxy 指定を処理）。
    identity 解決は session の studentId / email のみ（body 由来は使わない）。 */
export async function resolveStudentIdentity(user) {
  if (!user || user.role === 'admin') return null;

  const byId = user.studentId ? await lookupStudentById(user.studentId) : null;
  const byEmail = user.email ? await lookupStudentByEmail(user.email) : null;

  if (byId && isStudentLoginAllowed(byId)) return byId;
  if (byEmail && isStudentLoginAllowed(byEmail)) return byEmail;

  if (byEmail || byId) {
    denyAuth(403, 'Account not approved', 'login_disabled');
  }
  denyAuth(403, 'Student record not found', 'student_not_found');
}

export async function createExchangeToken(user) {
  return new SignJWT({ ...user, typ: 'exchange' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(getJwtSecret());
}

export async function createSessionToken(user) {
  return new SignJWT({
    email: user.email,
    name: user.name,
    display_name: user.display_name || null,
    role: user.role,
    studentId: user.studentId || user.id || null,
    typ: 'session',
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(getJwtSecret());
}

/** jose のクライアント JWT 検証失敗（署名不一致・期限切れ・壊れたトークン等）。
 *  JWT_SECRET 未設定などのサーバ設定不良は含まない。 */
export function isJoseClientAuthFailure(err) {
  if (!err) return false;
  const code = String(err.code || '');
  const name = String(err.name || '');
  if (code.startsWith('ERR_JWS_') || code.startsWith('ERR_JWT_') || code.startsWith('ERR_JOSE_')) {
    return true;
  }
  return [
    'JWSSignatureVerificationFailed',
    'JWSInvalid',
    'JWTExpired',
    'JWTClaimValidationFailed',
    'JWTInvalid',
    'JOSEError',
  ].includes(name);
}

function denySessionInvalid() {
  denyAuth(401, 'Unauthorized', 'session_invalid');
}

export async function verifyToken(token, expectedType) {
  // getJwtSecret() の設定不良は status なしのまま投げ、withCors で 500 にする。
  const secret = getJwtSecret();
  let payload;
  try {
    ({ payload } = await jwtVerify(token, secret));
  } catch (err) {
    if (isJoseClientAuthFailure(err)) denySessionInvalid();
    throw err;
  }
  if (expectedType && payload.typ !== expectedType) {
    denySessionInvalid();
  }
  return payload;
}

export function getBearerToken(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  return null;
}

export async function requireSession(req) {
  const token = getBearerToken(req);
  if (!token) {
    const err = new Error('Unauthorized');
    err.status = 401;
    throw err;
  }
  const payload = await verifyToken(token, 'session');
  return {
    email: payload.email,
    name: payload.name,
    display_name: payload.display_name || null,
    role: payload.role,
    studentId: payload.studentId || null,
  };
}

export function getGoogleOAuthClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error('Google OAuth env vars are not configured');
  }
  return { clientId, clientSecret, redirectUri };
}

export function getFrontendUrl() {
  return (process.env.FRONTEND_URL || 'https://9liplantara-sketch.github.io/ta-rabo-works').replace(/\/$/, '');
}
