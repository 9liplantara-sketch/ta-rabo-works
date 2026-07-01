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

export async function resolveUserFromEmail(email, nameFromGoogle) {
  const normalized = email.trim().toLowerCase();
  const student = await findStudentByEmail(normalized);
  if (student) {
    if (!student.is_active) return null;
    return {
      email: student.email,
      name: student.name || nameFromGoogle || student.email,
      role: student.role,
      studentId: student.id,
    };
  }

  const admins = getAdminEmails();
  if (admins.includes(normalized)) {
    return {
      email: normalized,
      name: nameFromGoogle || normalized,
      role: 'admin',
      studentId: null,
    };
  }

  return null;
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
    role: user.role,
    studentId: user.studentId,
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
