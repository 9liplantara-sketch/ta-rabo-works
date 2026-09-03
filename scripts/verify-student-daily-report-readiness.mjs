#!/usr/bin/env node
/**
 * Student daily report readiness audit + admin endpoint contract (pure).
 *
 * Production/DB に一切アクセスしない。
 */
import { readFileSync } from 'node:fs';
import {
  evaluateStudentDailyReportReadiness,
  evaluateStudentDailyReportReadinessFromStudentRow,
} from '../lib/student-daily-report-readiness.js';

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

function assertReady(result, label) {
  assert(result?.ready === true, label);
}

function assertNotReady(result, { label, status, errorCode, reasonIncludes } = {}) {
  assert(!result?.ready, label);
  if (status !== undefined) assert(result?.httpStatus === status, `${label}: httpStatus=${status}`);
  if (errorCode !== undefined) assert(result?.errorCode === errorCode, `${label}: errorCode=${errorCode}`);
  if (reasonIncludes !== undefined) {
    assert((result?.reasons || []).includes(reasonIncludes), `${label}: reasons includes ${reasonIncludes}`);
  }
}

const baseStudents = {
  A: {
    id: '11111111-1111-1111-1111-111111111111',
    name: 'Student A',
    email: 'student.a@example.com',
    role: 'student',
    display_name: null,
    is_active: true,
    login_enabled: true,
  },
  B: {
    id: '22222222-2222-2222-2222-222222222222',
    name: 'Student B',
    email: 'student.b@example.com',
    role: 'student',
    display_name: null,
    is_active: true,
    login_enabled: false, // login not allowed
  },
  C: {
    id: '33333333-3333-3333-3333-333333333333',
    name: 'Student C',
    email: null, // email missing → daily_reports.student_email NOT NULL → 500
    role: 'student',
    display_name: null,
    is_active: true,
    login_enabled: true,
  },
  D: {
    id: '44444444-4444-4444-4444-444444444444',
    name: 'Student D',
    email: 'student.d@example.com',
    role: 'student',
    display_name: 'D-Display',
    is_active: false, // inactive
    login_enabled: false,
  },
};

function makeAuthSessionUser(student, overrides = {}) {
  return {
    email: student?.email ?? null,
    name: student?.name ?? null,
    display_name: student?.display_name ?? null,
    role: student?.role,
    studentId: student?.id ?? null,
    ...overrides,
  };
}

console.log('\n=== Student daily report readiness (pure) ===\n');

// ── Readiness evaluator ─────────────────────────────────────────────────────

// 1) normal student → READY
{
  const result = evaluateStudentDailyReportReadinessFromStudentRow({
    student: baseStudents.A,
    students: [baseStudents.A],
  });
  assertReady(result, 'normal student A → READY');
  assert(result.studentId === baseStudents.A.id, 'A: studentId matches');
  assert(result.studentEmail === baseStudents.A.email, 'A: studentEmail matches');
}

// 2) student B (login_enabled=false) → NOT_READY
{
  const result = evaluateStudentDailyReportReadinessFromStudentRow({
    student: baseStudents.B,
    students: [baseStudents.B],
  });
  assertNotReady(result, { label: 'B: login_enabled=false → NOT_READY', status: 403, errorCode: 'login_disabled' });
}

// 3) student C (email null) → NOT_READY (db NOT NULL)
{
  const result = evaluateStudentDailyReportReadinessFromStudentRow({
    student: baseStudents.C,
    students: [baseStudents.C],
  });
  assertNotReady(result, {
    label: 'C: email null → NOT_READY',
    status: 500,
    errorCode: 'db_constraint_student_email_not_null',
    reasonIncludes: 'missing_student_email',
  });
}

// 4) student D (inactive) → NOT_READY
{
  const result = evaluateStudentDailyReportReadinessFromStudentRow({
    student: baseStudents.D,
    students: [baseStudents.D],
  });
  assertNotReady(result, { label: 'D: is_active=false → NOT_READY', status: 403, errorCode: 'login_disabled' });
}

// 5) email case difference in token → READY (studentId 一致で byId path)
{
  const result = evaluateStudentDailyReportReadiness({
    authSessionUser: makeAuthSessionUser(baseStudents.A, {
      email: '  STUDENT.A@EXAMPLE.com  ',
    }),
    students: [baseStudents.A],
  });
  assertReady(result, 'email case+whitespace mismatch, studentId present → READY');
}

// 6) email surrounding whitespace in token → READY
{
  const result = evaluateStudentDailyReportReadiness({
    authSessionUser: makeAuthSessionUser(baseStudents.A, {
      email: ' student.a@example.com ',
    }),
    students: [baseStudents.A],
  });
  assertReady(result, 'email whitespace mismatch, studentId present → READY');
}

// 7) email case diff, no studentId → email path normalizes → READY
{
  const result = evaluateStudentDailyReportReadiness({
    authSessionUser: { ...makeAuthSessionUser(baseStudents.A), studentId: null, email: 'STUDENT.A@EXAMPLE.COM' },
    students: [baseStudents.A],
  });
  assertReady(result, 'email uppercase, no studentId → email path normalized → READY');
}

// 8) no matching identity → NOT_READY
{
  const result = evaluateStudentDailyReportReadiness({
    authSessionUser: makeAuthSessionUser(baseStudents.A, {
      studentId: null,
      email: 'no-match@example.com',
    }),
    students: [baseStudents.A],
  });
  assertNotReady(result, { label: 'identity unmatched → NOT_READY', status: 403, errorCode: 'student_not_found' });
}

// 9) duplicate normalized email → NOT_READY (fail-closed)
{
  const s1 = { ...baseStudents.A, id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', email: 'dup@example.com' };
  const s2 = { ...baseStudents.A, id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', email: 'DUP@EXAMPLE.com' };
  const result = evaluateStudentDailyReportReadiness({
    authSessionUser: {
      email: 'dup@example.com',
      name: 'Dup',
      display_name: null,
      role: 'student',
      studentId: null,
    },
    students: [s1, s2],
  });
  assertNotReady(result, {
    label: 'duplicate normalized email, no studentId → NOT_READY',
    status: 403,
    errorCode: 'identity_ambiguous_email_duplicate',
    reasonIncludes: 'identity_ambiguous_email_duplicate',
  });
}

// 10) duplicate normalized email but studentId present → byId path → READY
{
  const s1 = { ...baseStudents.A, id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', email: 'dup@example.com' };
  const s2 = { ...baseStudents.A, id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', email: 'DUP@EXAMPLE.com' };
  const result = evaluateStudentDailyReportReadiness({
    authSessionUser: {
      email: 'dup@example.com',
      name: 'Dup',
      display_name: null,
      role: 'student',
      studentId: s1.id, // resolves via byId — no ambiguity
    },
    students: [s1, s2],
  });
  assertReady(result, 'duplicate normalized email but studentId → byId path → READY');
}

// 11) invalid role → login_disabled
{
  const s = { ...baseStudents.A, role: 'guest' };
  const result = evaluateStudentDailyReportReadiness({
    authSessionUser: makeAuthSessionUser(s, { studentId: s.id }),
    students: [s],
  });
  assertNotReady(result, { label: 'role=guest → NOT_READY', status: 403, errorCode: 'login_disabled' });
}

// 12) multi-student fixture: 2 READY, 1 NOT_READY (email null), 1 NOT_READY (login disabled)
{
  const students = [baseStudents.A, baseStudents.B, baseStudents.C, baseStudents.D];
  const results = students.map((s) =>
    evaluateStudentDailyReportReadinessFromStudentRow({ student: s, students }),
  );
  const readyCount = results.filter((r) => r.ready).length;
  const notReadyCount = results.filter((r) => !r.ready).length;
  assert(readyCount === 1, 'multi-student: 1 ready (A only)');
  assert(notReadyCount === 3, 'multi-student: 3 not ready (B/C/D)');
  assert(
    results[2].reasons.includes('missing_student_email'),
    'multi-student: C has missing_student_email',
  );
  assert(
    results[1].reasons.includes('login_disabled'),
    'multi-student: B has login_disabled',
  );
}

// ── Endpoint contract (source audit) ───────────────────────────────────────

console.log('\n=== Admin endpoint contract (source audit) ===\n');
{
  const studentsSrc = readFileSync(new URL('../api/students.js', import.meta.url), 'utf8');

  assert(
    studentsSrc.includes("action === 'daily-report-readiness'"),
    'endpoint: action=daily-report-readiness routing',
  );
  assert(
    studentsSrc.includes('handleDailyReportReadinessAudit'),
    'endpoint: handleDailyReportReadinessAudit exists',
  );
  assert(
    /handleDailyReportReadinessAudit[\s\S]*?role !== 'admin'/.test(studentsSrc),
    'endpoint: admin-only guard',
  );
  assert(
    /handleDailyReportReadinessAudit[\s\S]*?403[\s\S]*?admin_required/.test(studentsSrc),
    'endpoint: returns 403 admin_required for non-admin',
  );
  assert(
    /handleDailyReportReadinessAudit[\s\S]*?evaluateStudentDailyReportReadinessFromStudentRow/.test(studentsSrc),
    'endpoint: uses readiness evaluator',
  );
  // PII: response must not include name / display_name / email fields
  const handlerBody = studentsSrc.match(/async function handleDailyReportReadinessAudit[\s\S]*?\n\}/)?.[0] || '';
  assert(
    !handlerBody.includes('name:') && !handlerBody.includes('display_name:') && !handlerBody.includes('email:'),
    'endpoint: no PII (name/display_name/email) in response object',
  );
  // DB write check: no INSERT / UPDATE in the handler
  assert(
    !handlerBody.match(/\bINSERT\b|\bUPDATE\b|\bcreateStudent\b|\bupdateStudent\b/),
    'endpoint: no DB write in handler',
  );
  // reason_counts aggregated
  assert(handlerBody.includes('reason_counts'), 'endpoint: returns reason_counts');
  // validation field
  assert(handlerBody.includes('validation'), 'endpoint: returns validation field');
  // normalized email duplicate groups
  assert(
    handlerBody.includes('normalized_email_duplicate_groups'),
    'endpoint: returns normalized_email_duplicate_groups',
  );
  // not_ready_details contain only index + reasons (no uuid/name/email)
  assert(
    handlerBody.includes('not_ready_details'),
    'endpoint: returns not_ready_details for non-ready students',
  );

  // 403 for student (non-admin) — separate mock test
  assert(
    studentsSrc.includes("'admin_required'"),
    'endpoint: code=admin_required in 403 response',
  );

  // Vercel function limit: adding import to existing file must not add new entrypoint
  assert(
    !studentsSrc.includes('api/admin/'),
    'endpoint: no new api/admin/ file (would exceed Hobby limit)',
  );
}

// ── Session handling contract ───────────────────────────────────────────────

console.log('\n=== Session contract ===\n');
{
  const src = readFileSync(new URL('../api/students.js', import.meta.url), 'utf8');
  assert(src.includes('requireSession(req)'), 'students.js: requireSession gates all requests including audit');
  assert(src.includes('enrichUserFromDb(session)'), 'students.js: enrichUserFromDb gates all requests');
  // requireSession happens before the action branch → 401 session_invalid for invalid token
  const reqSessionIdx = src.indexOf('requireSession(req)');
  const actionIdx = src.indexOf("action === 'daily-report-readiness'");
  assert(reqSessionIdx < actionIdx, 'requireSession runs before action dispatch');
}

console.log(`\nStudent readiness: ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
