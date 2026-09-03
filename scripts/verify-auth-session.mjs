#!/usr/bin/env node
/**
 * Auth session JWT classification + frontend recovery contract tests.
 * Does not call Production or print secrets.
 */
import { readFileSync } from 'node:fs';
import { SignJWT } from 'jose';
import {
  createSessionToken,
  requireSession,
  verifyToken,
  isJoseClientAuthFailure,
} from '../lib/auth.js';

let passed = 0;
let failed = 0;

function assert(cond, label) {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}`);
  }
}

async function assertThrows(fn, label, { status, code, messageIncludes } = {}) {
  try {
    await fn();
    assert(false, `${label} (expected throw)`);
  } catch (e) {
    const okStatus = status === undefined || e.status === status;
    const okCode = code === undefined || e.code === code;
    const okMsg =
      messageIncludes === undefined || String(e.message || '').includes(messageIncludes);
    assert(okStatus && okCode && okMsg, `${label} → status=${e.status} code=${e.code}`);
  }
}

function reqWithBearer(token) {
  return {
    headers: {
      authorization: token == null ? '' : `Bearer ${token}`,
    },
  };
}

const TEST_SECRET = `test-jwt-secret-${'x'.repeat(48)}`;
const encoder = new TextEncoder();

async function main() {
  console.log('\n=== Auth session JWT classification ===\n');

  const prevSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = TEST_SECRET;

  const user = {
    email: 'student@example.com',
    name: 'Test Student',
    display_name: 'TS',
    role: 'student',
    studentId: '11111111-1111-1111-1111-111111111111',
  };

  const valid = await createSessionToken(user);
  const session = await requireSession(reqWithBearer(valid));
  assert(session.email === user.email, 'valid JWT → requireSession ok');
  assert(session.role === 'student', 'valid JWT → role preserved');

  await assertThrows(
    () => requireSession(reqWithBearer(null)),
    'missing JWT → 401 (no session_invalid)',
    { status: 401, code: undefined },
  );
  try {
    await requireSession({ headers: {} });
    assert(false, 'missing Authorization header');
  } catch (e) {
    assert(e.status === 401 && e.code == null, 'missing Authorization → 401 without code');
  }

  const expired = await new SignJWT({
    email: user.email,
    name: user.name,
    role: user.role,
    studentId: user.studentId,
    typ: 'session',
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
    .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
    .sign(encoder.encode(TEST_SECRET));
  await assertThrows(
    () => requireSession(reqWithBearer(expired)),
    'expired JWT → 401 session_invalid',
    { status: 401, code: 'session_invalid' },
  );

  const otherSecret = encoder.encode(`other-jwt-secret-${'y'.repeat(48)}`);
  const wrongSig = await new SignJWT({
    email: user.email,
    name: user.name,
    role: user.role,
    studentId: user.studentId,
    typ: 'session',
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(otherSecret);
  await assertThrows(
    () => requireSession(reqWithBearer(wrongSig)),
    'wrong signature JWT → 401 session_invalid',
    { status: 401, code: 'session_invalid' },
  );

  await assertThrows(
    () => requireSession(reqWithBearer('not-a-jwt')),
    'malformed JWT → 401 session_invalid',
    { status: 401, code: 'session_invalid' },
  );

  const exchangeTyp = await new SignJWT({
    email: user.email,
    name: user.name,
    role: user.role,
    typ: 'exchange',
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(encoder.encode(TEST_SECRET));
  await assertThrows(
    () => requireSession(reqWithBearer(exchangeTyp)),
    'wrong typ → 401 session_invalid',
    { status: 401, code: 'session_invalid' },
  );

  // Server misconfiguration must NOT become 401
  delete process.env.JWT_SECRET;
  await assertThrows(
    () => requireSession(reqWithBearer(valid)),
    'JWT_SECRET missing → not 401',
    { status: undefined, messageIncludes: 'JWT_SECRET' },
  );
  try {
    await requireSession(reqWithBearer(valid));
  } catch (e) {
    assert(e.status !== 401 && e.code !== 'session_invalid', 'JWT_SECRET missing → not session_invalid');
  }

  process.env.JWT_SECRET = 'short';
  await assertThrows(
    () => requireSession(reqWithBearer(valid)),
    'JWT_SECRET too short → not 401',
    { status: undefined, messageIncludes: 'JWT_SECRET' },
  );

  process.env.JWT_SECRET = TEST_SECRET;
  assert(
    isJoseClientAuthFailure({ code: 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED', name: 'JWSSignatureVerificationFailed' }),
    'classifier: signature failure',
  );
  assert(
    !isJoseClientAuthFailure(new Error('JWT_SECRET must be set (32+ characters)')),
    'classifier: config error is not client auth failure',
  );

  // verifyToken itself classifies jose failures
  await assertThrows(
    () => verifyToken('abc.def.ghi', 'session'),
    'verifyToken malformed → session_invalid',
    { status: 401, code: 'session_invalid' },
  );

  console.log('\n=== Frontend / daily-report contracts ===\n');

  const authSrc = readFileSync(new URL('../assets/js/ta-rabo-auth.js', import.meta.url), 'utf8');
  assert(authSrc.includes("code === 'session_invalid'"), 'apiFetch handles session_invalid');
  assert(authSrc.includes('clearSession()'), 'session recovery clears token');
  assert(authSrc.includes('session_invalid:'), 'AUTH_ERRORS.session_invalid present');
  assert(authSrc.includes('updateAuthUI'), 'session recovery updates auth UI');
  assert(!/if \(res\.status === 403 && data\.code === 'session_invalid'\)/.test(authSrc), '403 not treated as session_invalid');

  const labSrc = readFileSync(new URL('../lab_manager.html', import.meta.url), 'utf8');
  assert(labSrc.includes('session_invalid'), 'formatDailyReportError knows session_invalid');
  assert(
    labSrc.includes('セッションの有効期限が切れました'),
    'daily report shows re-login message',
  );
  assert(
    /saveReportApi[\s\S]*?catch \(e\) \{[\s\S]*?失敗時は form をクリアしない/.test(labSrc),
    'saveReportApi preserves form on failure',
  );
  assert(
    /updateReportApi[\s\S]*?catch \(e\) \{[\s\S]*?失敗時は form をクリアしない/.test(labSrc),
    'updateReportApi preserves form on failure',
  );
  // success path clears; catch must not call resetReportFormMode before toast
  const saveCatch = labSrc.match(/async function saveReportApi[\s\S]*?async function updateReportApi/);
  assert(saveCatch, 'saveReportApi block found');
  if (saveCatch) {
    const catchPart = saveCatch[0].split('catch (e)')[1] || '';
    assert(!catchPart.includes('resetReportFormMode'), 'save failure path does not reset form');
  }

  const dailyApi = readFileSync(new URL('../api/daily-reports.js', import.meta.url), 'utf8');
  assert(dailyApi.includes('requireSession(req)'), 'POST daily-reports gated by requireSession');
  assert(
    dailyApi.indexOf('requireSession') < dailyApi.indexOf('createDailyReport'),
    'requireSession runs before createDailyReport (no DB write without session)',
  );

  if (prevSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = prevSecret;

  console.log(`\nAuth session: ${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
