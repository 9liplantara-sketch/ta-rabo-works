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

/** セッション JWT を Neon の最新 students 行で補完する。
    在籍停止(is_active=false)・ログイン許可取消(login_enabled=false)されたら 403 で弾く。
    env 管理者は承認の起点なので students 行が無くても admin として通す。 */
export async function enrichUserFromDb(sessionUser) {
  const admins = getAdminEmails();
  const isEnvAdmin = sessionUser.email && admins.includes(String(sessionUser.email).toLowerCase());

  const denyInactive = () => {
    const err = new Error('Account not approved');
    err.status = 403;
    throw err;
  };

  if (sessionUser.studentId) {
    const { findStudentById } = await import('./db.js');
    const student = await findStudentById(sessionUser.studentId);
    if (student) {
      if (isEnvAdmin) {
        const user = mapStudentToUser(student);
        user.role = 'admin';
        return user;
      }
      if (!isStudentLoginAllowed(student)) denyInactive();
      return mapStudentToUser(student);
    }
  }
  const student = await findStudentByEmail(sessionUser.email);
  if (student) {
    if (isEnvAdmin) {
      const user = mapStudentToUser(student);
      user.role = 'admin';
      return user;
    }
    if (!isStudentLoginAllowed(student)) denyInactive();
    return mapStudentToUser(student);
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
  denyInactive();
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

export async function verifyToken(token, expectedType) {
  const { payload } = await jwtVerify(token, getJwtSecret());
  if (expectedType && payload.typ !== expectedType) {
    throw new Error('Invalid token type');
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
