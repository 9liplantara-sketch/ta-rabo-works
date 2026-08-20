#!/usr/bin/env node
/**
 * Phase 1.5 検証スクリプト（純粋関数 + 任意で Neon 実DB）
 *
 * 使い方:
 *   node scripts/verify-phase-1-5.mjs
 *   DATABASE_URL='postgresql://...' node scripts/verify-phase-1-5.mjs
 */
import {
  toIlikePattern,
  canViewReport,
  canEditReport,
  reportOwnedByUser,
  parseListParams,
  sanitizeAttachments,
  parseSessionKey,
  parseVisibility,
  resolveDailyReportStudentFields,
  VALID_VISIBILITY,
} from '../lib/daily-reports.js';
import {
  resolveStudentIdentity,
  __testSetStudentLookup,
  __testResetStudentLookup,
} from '../lib/auth.js';
import {
  __testSetFindStudentByEmail,
  __testResetFindStudentByEmail,
} from '../lib/db.js';
import { isDailyReportEligibleForKnowledge } from '../lib/knowledge-access.js';
import { filterDailyReportsForKnowledgeFeed } from '../lib/knowledge-sources.js';
import { filterDailyReportsForAnalysis } from '../lib/member-qualitative-sources.js';

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

async function assertThrows(fn, label, { status, code } = {}) {
  try {
    await fn();
    assert(false, `${label} (expected throw)`);
  } catch (e) {
    const okStatus = status === undefined || e.status === status;
    const okCode = code === undefined || e.code === code;
    assert(okStatus && okCode, `${label} → ${e.status}/${e.code}`);
  }
}

function studentRow({ id, email, name = 'Test', active = true, login = true }) {
  return {
    id,
    name,
    email,
    role: 'student',
    display_name: null,
    note: null,
    icon_color: null,
    enrolled_at: null,
    is_active: active,
    login_enabled: login,
    created_at: null,
    updated_at: null,
  };
}

console.log('\n=== Phase 1.5: 純粋関数 ===\n');

// toIlikePattern
assert(toIlikePattern('') === null, 'empty q → null');
assert(toIlikePattern('テスト') === '%テスト%', 'plain keyword');
assert(toIlikePattern('100%') === '%100\\%%', 'escape percent');
assert(toIlikePattern('a_b') === '%a\\_b%', 'escape underscore');
assert(toIlikePattern('path\\x') === '%path\\\\x%', 'escape backslash');

// parseListParams dates
const p1 = parseListParams({ view: 'mine', limit: '50', offset: '0' });
assert(p1.from === null && p1.to === null, 'from/to omitted → null');

const p2 = parseListParams({ from: '2026-08-01', to: '2026-08-11' });
assert(p2.from === '2026-08-01' && p2.to === '2026-08-11', 'from+to parsed');

try {
  parseListParams({ from: 'bad-date' });
  assert(false, 'invalid from should throw');
} catch (e) {
  assert(e.status === 400, 'invalid from → 400');
}

// visibility / permissions
const studentA = { role: 'student', email: 'a@example.com', studentId: 'uuid-a' };
const studentB = { role: 'student', email: 'b@example.com', studentId: 'uuid-b' };
const admin = { role: 'admin', email: 'admin@example.com' };

const repPrivate = { student_id: 'uuid-a', student_email: 'a@example.com', visibility: 'private' };
const repLab = { student_id: 'uuid-a', student_email: 'a@example.com', visibility: 'lab' };
const repPublic = { student_id: 'uuid-a', student_email: 'a@example.com', visibility: 'public' };
const repEmailChanged = { student_id: 'uuid-a', student_email: 'old-a@example.com', visibility: 'private' };

assert(canViewReport(studentA, repPrivate), 'A views own private');
assert(!canViewReport(studentB, repPrivate), 'B cannot view A private');
assert(canViewReport(studentB, repLab), 'B views A lab');
assert(canViewReport(studentB, repPublic), 'B views A public');
assert(canViewReport(admin, repPrivate), 'admin views A private');

assert(canEditReport(studentA, repPrivate), 'A edits own');
assert(!canEditReport(studentB, repLab), 'B cannot edit A lab');
assert(canEditReport(admin, repLab), 'admin edits A lab');

assert(reportOwnedByUser(studentA, repEmailChanged), 'ownership by student_id when email changed');
assert(canEditReport(studentA, repEmailChanged), 'A edits own when email on report is stale');
assert(canViewReport(studentA, repEmailChanged), 'A views own private when email on report is stale');
assert(!reportOwnedByUser(studentB, repEmailChanged), 'B does not own A report by student_id');

const repIdEmailConflict = { student_id: 'uuid-b', student_email: 'a@example.com', visibility: 'private' };
assert(!reportOwnedByUser(studentA, repIdEmailConflict), 'conflict: student_id wins over email');
assert(!canEditReport(studentA, repIdEmailConflict), 'PATCH forbidden when student_id is another student');
assert(!canViewReport(studentA, repIdEmailConflict), 'private conflict row not visible to A');

const repLegacyNoId = { student_id: null, student_email: 'a@example.com', visibility: 'private' };
assert(reportOwnedByUser(studentA, repLegacyNoId), 'legacy row: email fallback when student_id null');
assert(canEditReport(studentA, repLegacyNoId), 'legacy row: PATCH via email fallback');
assert(canViewReport(studentA, repLegacyNoId), 'legacy row: view=mine via email fallback');

const repStaleEmailOwnId = { student_id: 'uuid-a', student_email: 'old-a@example.com', visibility: 'private' };
assert(canEditReport(studentA, repStaleEmailOwnId), 'PATCH ok: own student_id + stale email');

// attachments sanitize
const att = sanitizeAttachments([
  { url: 'https://example.com/a.pdf', type: 'pdf', title: 'A', note: 'n' },
  { url: 'ftp://bad', type: 'pdf' },
  { url: 'https://example.com/b.png', type: 'invalid', title: 'B' },
]);
assert(att.length === 2, 'sanitize drops invalid url, normalizes type');
assert(att[1].type === 'other', 'unknown type → other');

// session_key（緩いバリデーション）
assert(parseSessionKey(null).value === null, 'session_key null → null');
assert(parseSessionKey('').value === null, 'session_key empty → null');
assert(parseSessionKey('  seminar_2026_009  ').value === 'seminar_2026_009', 'session_key trim');
assert(parseSessionKey('x'.repeat(200)).ok === true, 'session_key max len ok');
const tooLong = parseSessionKey('x'.repeat(201));
assert(tooLong.ok === false, 'session_key too long → error');

const lpSk = parseListParams({ session_key: 'seminar_2026_009' });
assert(lpSk.sessionKey === 'seminar_2026_009', 'parseListParams session_key');

console.log('\n=== Phase 1.5: resolveStudentIdentity (contract) ===\n');

const activeA = studentRow({ id: 'uuid-a', email: 'a@example.com', name: 'Student A' });
const activeB = studentRow({ id: 'uuid-b', email: 'b@example.com', name: 'Student B' });
const inactiveOld = studentRow({
  id: 'uuid-old',
  email: 'old@example.com',
  name: 'Old',
  active: false,
  login: false,
});
const disabledOnly = studentRow({
  id: 'uuid-dis',
  email: 'dis@example.com',
  active: true,
  login: false,
});

// A: active student, studentId = self
__testSetStudentLookup({
  findById: (id) => (id === 'uuid-a' ? activeA : null),
  findByEmail: (email) => (email === 'a@example.com' ? activeA : null),
});
{
  const sessionUser = { role: 'student', email: 'a@example.com', studentId: 'uuid-a' };
  const resolved = await resolveStudentIdentity(sessionUser);
  assert(resolved?.id === 'uuid-a', 'A: resolves own students.id');
}
__testResetStudentLookup();

// B: stale JWT studentId (inactive row), session email → active row
__testSetStudentLookup({
  findById: (id) => {
    if (id === 'uuid-old') return inactiveOld;
    if (id === 'uuid-a') return activeA;
    return null;
  },
  findByEmail: (email) => {
    if (email === 'a@example.com') return activeA;
    return null;
  },
});
{
  const sessionUser = { role: 'student', email: 'a@example.com', studentId: 'uuid-old' };
  const resolved = await resolveStudentIdentity(sessionUser);
  assert(resolved?.id === 'uuid-a', 'B: email fallback resolves active student');
}
__testResetStudentLookup();

// C: inactive byId + no active student for session email
__testSetStudentLookup({
  findById: (id) => (id === 'uuid-old' ? inactiveOld : null),
  findByEmail: () => null,
});
{
  const sessionUser = { role: 'student', email: 'missing@example.com', studentId: 'uuid-old' };
  await assertThrows(
    () => resolveStudentIdentity(sessionUser),
    'C: no active student',
    { status: 403, code: 'login_disabled' },
  );
}
__testResetStudentLookup();

// C2: no students row at all
__testSetStudentLookup({
  findById: () => null,
  findByEmail: () => null,
});
{
  const sessionUser = { role: 'student', email: 'ghost@example.com', studentId: 'uuid-missing' };
  await assertThrows(
    () => resolveStudentIdentity(sessionUser),
    'C2: student_not_found',
    { status: 403, code: 'student_not_found' },
  );
}
__testResetStudentLookup();

// C variant: email exists but login disabled
__testSetStudentLookup({
  findById: () => null,
  findByEmail: (email) => (email === 'dis@example.com' ? disabledOnly : null),
});
{
  const sessionUser = { role: 'student', email: 'dis@example.com', studentId: null };
  await assertThrows(
    () => resolveStudentIdentity(sessionUser),
    'C/D: login_disabled',
    { status: 403, code: 'login_disabled' },
  );
}
__testResetStudentLookup();

// D: resolved row is_active=false (via byId only)
__testSetStudentLookup({
  findById: (id) => (id === 'uuid-old' ? inactiveOld : null),
  findByEmail: (email) => (email === 'old@example.com' ? inactiveOld : null),
});
{
  const sessionUser = { role: 'student', email: 'old@example.com', studentId: 'uuid-old' };
  await assertThrows(
    () => resolveStudentIdentity(sessionUser),
    'D: inactive student cannot save',
    { status: 403, code: 'login_disabled' },
  );
}
__testResetStudentLookup();

console.log('\n=== Phase 1.5: POST identity / spoof protection (contract) ===\n');

__testSetStudentLookup({
  findById: (id) => (id === 'uuid-a' ? activeA : null),
  findByEmail: (email) => {
    if (email === 'a@example.com') return activeA;
    if (email === 'b@example.com') return activeB;
    return null;
  },
});

const studentSessionA = { role: 'student', email: 'a@example.com', studentId: 'uuid-a', name: 'A' };

for (const vis of VALID_VISIBILITY) {
  const visResult = parseVisibility(vis, { required: true });
  assert(visResult.ok, `visibility ${vis} parseable`);
  const fields = await resolveDailyReportStudentFields(studentSessionA, {
    report_date: '2026-08-20',
    did_today: 'test',
    visibility: vis,
    student_id: 'uuid-b',
    student_email: 'b@example.com',
  });
  assert(fields.studentId === 'uuid-a', `POST ${vis}: student_id = resolved A`);
  assert(fields.studentEmail === 'a@example.com', `POST ${vis}: email = session-resolved A`);
}

const spoofId = await resolveDailyReportStudentFields(studentSessionA, {
  student_id: 'uuid-b',
  studentId: 'uuid-b',
});
assert(spoofId.studentId === 'uuid-a', 'spoof: body.student_id=B ignored');
assert(spoofId.studentEmail === 'a@example.com', 'spoof: body.student_email=B ignored');

__testResetStudentLookup();

console.log('\n=== Phase 1.5: admin proxy POST (contract) ===\n');

__testSetFindStudentByEmail((email) => (email === 'b@example.com' ? activeB : null));
{
  const adminUser = { role: 'admin', email: 'admin@example.com', studentId: null, name: 'Admin' };
  const fields = await resolveDailyReportStudentFields(adminUser, {
    student_email: 'b@example.com',
    student_name: 'Proxy B',
  });
  assert(fields.studentId === 'uuid-b', 'admin proxy: student_id = target B');
  assert(fields.studentEmail === 'b@example.com', 'admin proxy: email = target B');
}
__testResetFindStudentByEmail();

__testSetStudentLookup({
  findById: (id) => (id === 'uuid-a' ? activeA : null),
  findByEmail: (email) => (email === 'a@example.com' ? activeA : email === 'b@example.com' ? activeB : null),
});
{
  const studentNoProxy = await resolveDailyReportStudentFields(studentSessionA, {
    student_email: 'b@example.com',
  });
  assert(studentNoProxy.studentId === 'uuid-a', 'student cannot proxy via body.student_email');
}
__testResetStudentLookup();

console.log('\n=== Phase 1.5: privacy regression (daily reports) ===\n');

const privateRep = {
  id: 'r-priv',
  student_id: 'uuid-a',
  student_email: 'a@example.com',
  visibility: 'private',
  student_name: 'A',
  report_date: '2026-08-01',
  did_today: 'secret',
};
const labRep = { ...privateRep, id: 'r-lab', visibility: 'lab' };

assert(canViewReport(studentA, privateRep), 'private: owner view=mine GET ok');
assert(!isDailyReportEligibleForKnowledge(privateRep), 'private: excluded from Knowledge layer');
assert(filterDailyReportsForKnowledgeFeed([privateRep, labRep]).length === 1, 'Knowledge feed: lab only');
assert(
  filterDailyReportsForAnalysis([privateRep, labRep]).length === 1,
  'M3-L AI sources: private excluded',
);
assert(isDailyReportEligibleForKnowledge(labRep), 'lab: Knowledge eligible');

console.log('\n=== Phase 1.5: Neon 実DB（任意）===\n');

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.log('  (skip) DATABASE_URL 未設定 — ILIKE / index / 日付境界は手動確認');
} else {
  const { neon } = await import('@neondatabase/serverless');
  const sql = neon(dbUrl);

  const idx = await sql`
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'daily_reports'
      AND indexname = 'idx_daily_reports_student_date'
  `;
  assert(idx.length > 0, 'idx_daily_reports_student_date が Neon に存在');

  const ESC = '\\';
  const patterns = [
    ['plain', toIlikePattern('ILIKE_TEST_MARKER')],
    ['percent', toIlikePattern('100%')],
    ['underscore', toIlikePattern('a_b')],
    ['backslash', toIlikePattern('x\\y')],
  ];

  for (const [label, pattern] of patterns) {
    if (!pattern) continue;
    const rows = await sql`
      SELECT ${pattern} ILIKE ${pattern} ESCAPE ${ESC} AS self_match
    `;
    assert(rows[0]?.self_match === true, `PostgreSQL ILIKE self-match (${label})`);
  }

  const boundary = await sql`
    SELECT
      ('2026-08-01'::date >= '2026-08-01'::date) AS from_inclusive,
      ('2026-08-11'::date <= '2026-08-11'::date) AS to_inclusive
  `;
  assert(boundary[0]?.from_inclusive && boundary[0]?.to_inclusive, 'date boundary inclusive');
}

console.log(`\n--- 結果: ${passed} passed, ${failed} failed ---\n`);
process.exit(failed > 0 ? 1 : 0);
