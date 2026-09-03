#!/usr/bin/env node
/**
 * Student daily report readiness audit + registration guard + admin endpoint (pure).
 *
 * Production/DB に一切アクセスしない。
 */
import { readFileSync } from 'node:fs';
import {
  evaluateStudentDailyReportReadiness,
  evaluateStudentDailyReportReadinessFromStudentRow,
  evaluateStudentDailyReportReadinessCandidate,
} from '../lib/student-daily-report-readiness.js';
import {
  normalizeOptionalStudentEmail,
  normalizeStudentEmail,
  hasNormalizedEmailDuplicate,
  resolveCreateLoginEnabled,
} from '../lib/student-lifecycle.js';

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
    login_enabled: false,
  },
  C: {
    id: '33333333-3333-3333-3333-333333333333',
    name: 'Student C',
    email: null,
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
    is_active: false,
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

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n=== Student daily report readiness (pure) ===\n');
// ═══════════════════════════════════════════════════════════════════════════

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

// 5) email case difference in token → READY (studentId path)
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
      studentId: s1.id,
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

// 12) multi-student fixture
{
  const students = [baseStudents.A, baseStudents.B, baseStudents.C, baseStudents.D];
  const results = students.map((s) =>
    evaluateStudentDailyReportReadinessFromStudentRow({ student: s, students }),
  );
  assert(results.filter((r) => r.ready).length === 1, 'multi-student: 1 ready (A only)');
  assert(results.filter((r) => !r.ready).length === 3, 'multi-student: 3 not ready (B/C/D)');
  assert(results[2].reasons.includes('missing_student_email'), 'multi-student: C has missing_student_email');
  assert(results[1].reasons.includes('login_disabled'), 'multi-student: B has login_disabled');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n=== Email normalization + duplicate detection ===\n');
// ═══════════════════════════════════════════════════════════════════════════

{
  // normalizeStudentEmail
  assert(normalizeStudentEmail('Test@Example.COM').value === 'test@example.com', 'normalizeStudentEmail: lowercase');
  assert(normalizeStudentEmail(' test@example.com ').value === 'test@example.com', 'normalizeStudentEmail: trim');
  assert(!normalizeStudentEmail('').ok, 'normalizeStudentEmail: empty → not ok');
  assert(!normalizeStudentEmail(null).ok, 'normalizeStudentEmail: null → not ok');
  assert(!normalizeStudentEmail('invalid').ok, 'normalizeStudentEmail: no @ → not ok');

  // normalizeOptionalStudentEmail（既存）
  assert(normalizeOptionalStudentEmail('').value === null, 'normalizeOptional: empty → null');
  assert(normalizeOptionalStudentEmail(null).value === null, 'normalizeOptional: null → null');

  // hasNormalizedEmailDuplicate
  const students = [baseStudents.A, baseStudents.B];
  assert(hasNormalizedEmailDuplicate(students, 'student.a@example.com') === true, 'dup: exact match → true');
  assert(hasNormalizedEmailDuplicate(students, 'STUDENT.A@EXAMPLE.COM') === true, 'dup: case diff → true');
  assert(hasNormalizedEmailDuplicate(students, ' student.a@example.com ') === true, 'dup: whitespace → true');
  assert(hasNormalizedEmailDuplicate(students, 'new@example.com') === false, 'dup: no match → false');
  assert(hasNormalizedEmailDuplicate(students, null) === false, 'dup: null → false');
  // excludeId
  assert(
    hasNormalizedEmailDuplicate(students, 'student.a@example.com', baseStudents.A.id) === false,
    'dup: self excluded → false',
  );
  assert(
    hasNormalizedEmailDuplicate(students, 'student.a@example.com', baseStudents.B.id) === true,
    'dup: other excluded → still true',
  );
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n=== Registration guard: create ===\n');
// ═══════════════════════════════════════════════════════════════════════════

{
  const existingStudents = [baseStudents.A];

  // valid new student → READY
  {
    const candidate = {
      id: '__new__',
      name: 'New Student',
      email: 'new@example.com',
      display_name: null,
      role: 'student',
      is_active: true,
      login_enabled: true,
    };
    const result = evaluateStudentDailyReportReadinessCandidate({
      candidate,
      existingStudents,
    });
    assertReady(result, 'create: valid student → READY');
  }

  // missing email → NOT_READY
  {
    const candidate = {
      id: '__new__',
      name: 'No Email',
      email: null,
      display_name: null,
      role: 'student',
      is_active: true,
      login_enabled: true,
    };
    const result = evaluateStudentDailyReportReadinessCandidate({
      candidate,
      existingStudents,
    });
    assertNotReady(result, {
      label: 'create: missing email → NOT_READY',
      reasonIncludes: 'missing_student_email',
    });
  }

  // normalized duplicate email → detected by hasNormalizedEmailDuplicate (API-level guard)
  // Note: evaluateStudentDailyReportReadinessCandidate uses studentId, so byId resolves
  // without ambiguity. The API guard uses hasNormalizedEmailDuplicate separately → 409.
  {
    assert(
      hasNormalizedEmailDuplicate(existingStudents, 'STUDENT.A@EXAMPLE.COM'),
      'create: normalized dup email detected by hasNormalizedEmailDuplicate',
    );
    assert(
      hasNormalizedEmailDuplicate(existingStudents, ' student.a@example.com '),
      'create: whitespace dup email detected by hasNormalizedEmailDuplicate',
    );
    // New unique email: no dup
    assert(
      !hasNormalizedEmailDuplicate(existingStudents, 'unique@example.com'),
      'create: unique email → no dup',
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n=== Registration guard: update ===\n');
// ═══════════════════════════════════════════════════════════════════════════

{
  const existingStudents = [baseStudents.A, baseStudents.B];

  // healthy student display_name change → READY
  {
    const candidate = { ...baseStudents.A, display_name: 'New Display' };
    const others = existingStudents.filter((s) => s.id !== candidate.id);
    const result = evaluateStudentDailyReportReadinessCandidate({
      candidate,
      existingStudents: others,
    });
    assertReady(result, 'update: display_name change → READY');
  }

  // healthy student email deletion → email becomes null → NOT_READY
  {
    const candidate = { ...baseStudents.A, email: null };
    const others = existingStudents.filter((s) => s.id !== candidate.id);
    const result = evaluateStudentDailyReportReadinessCandidate({
      candidate,
      existingStudents: others,
    });
    assertNotReady(result, {
      label: 'update: email deleted → NOT_READY',
      reasonIncludes: 'missing_student_email',
    });
  }

  // healthy student email → duplicate with B → detected by hasNormalizedEmailDuplicate
  {
    assert(
      hasNormalizedEmailDuplicate(existingStudents, 'STUDENT.B@EXAMPLE.COM', baseStudents.A.id),
      'update: email dup with B detected by hasNormalizedEmailDuplicate',
    );
    // Self email unchanged → no dup
    assert(
      !hasNormalizedEmailDuplicate(existingStudents, 'student.a@example.com', baseStudents.A.id),
      'update: self email unchanged → no dup',
    );
  }

  // self email unchanged → READY (no dup with self)
  {
    const candidate = { ...baseStudents.A }; // same email
    const others = existingStudents.filter((s) => s.id !== candidate.id);
    const result = evaluateStudentDailyReportReadinessCandidate({
      candidate,
      existingStudents: others,
    });
    assertReady(result, 'update: self email unchanged → READY');
  }

  // active → login_enabled=false → intentional disable (evaluator returns NOT_READY but this is allowed)
  {
    const candidate = { ...baseStudents.A, login_enabled: false };
    const others = existingStudents.filter((s) => s.id !== candidate.id);
    const result = evaluateStudentDailyReportReadinessCandidate({
      candidate,
      existingStudents: others,
    });
    // Evaluator says NOT_READY (login_disabled), but api/students.js allows this
    // because finalLoginEnabled=false means guard is skipped.
    assertNotReady(result, {
      label: 'update: login_enabled=false → evaluator NOT_READY (expected)',
      errorCode: 'login_disabled',
    });
  }

  // disabled student display_name change → evaluator NOT_READY but api allows
  {
    const candidate = { ...baseStudents.D, display_name: 'Updated D' };
    const result = evaluateStudentDailyReportReadinessCandidate({
      candidate,
      existingStudents: [baseStudents.D],
    });
    assertNotReady(result, {
      label: 'update: disabled student edit → evaluator NOT_READY (expected, api skips guard)',
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n=== API source: registration guard contract ===\n');
// ═══════════════════════════════════════════════════════════════════════════

{
  const src = readFileSync(new URL('../api/students.js', import.meta.url), 'utf8');

  // POST guard
  assert(src.includes('student_email_conflict'), 'POST: returns student_email_conflict on dup');
  assert(src.includes('student_not_ready'), 'POST: returns student_not_ready code');
  assert(src.includes('evaluateStudentDailyReportReadinessCandidate'), 'POST: uses candidate evaluator');
  assert(src.includes('hasNormalizedEmailDuplicate'), 'POST: uses hasNormalizedEmailDuplicate');

  // POST: guard runs before createStudent
  const postBlock = src.match(/req\.method === 'POST'[\s\S]*?req\.method === 'PATCH'/)?.[0] || '';
  const guardIdx = postBlock.indexOf('student_not_ready');
  const createIdx = postBlock.indexOf('createStudent(');
  assert(guardIdx > 0 && createIdx > 0 && guardIdx < createIdx, 'POST: guard runs before createStudent');

  // POST: duplicate check runs before createStudent
  const dupIdx = postBlock.indexOf('student_email_conflict');
  assert(dupIdx > 0 && dupIdx < createIdx, 'POST: dup check runs before createStudent');

  // PATCH guard
  const patchBlock = src.match(/req\.method === 'PATCH'[\s\S]*?405/)?.[0] || '';
  assert(patchBlock.includes('student_email_conflict'), 'PATCH: returns student_email_conflict on dup');
  assert(patchBlock.includes('student_not_ready'), 'PATCH: returns student_not_ready code');
  assert(patchBlock.includes('evaluateStudentDailyReportReadinessCandidate'), 'PATCH: uses candidate evaluator');

  // PATCH: guard only when finalLoginEnabled && finalIsActive
  assert(patchBlock.includes('finalLoginEnabled') && patchBlock.includes('finalIsActive'),
    'PATCH: guard condition checks finalLoginEnabled && finalIsActive');

  // PATCH: guard runs before updateStudent
  const patchGuardIdx = patchBlock.indexOf('student_not_ready');
  const updateIdx = patchBlock.indexOf('updateStudent(');
  assert(patchGuardIdx > 0 && updateIdx > 0 && patchGuardIdx < updateIdx,
    'PATCH: guard runs before updateStudent');

  // PATCH: duplicate excludes self (targetId)
  assert(patchBlock.includes('targetId'), 'PATCH: dup check uses targetId for self-exclusion');

  // No PII in guard error response objects (check the JSON response lines only)
  // The guard response must not contain user email values, only codes
  const guardResponseLines = src.split('\n').filter((l) =>
    l.includes('student_not_ready') || l.includes('student_email_conflict'),
  );
  const hasPIIInGuard = guardResponseLines.some((l) =>
    /@.*\.com/.test(l) || /email:\s*['"]/.test(l),
  );
  assert(!hasPIIInGuard, 'guard errors: no email PII in response lines');

  // Japanese error messages for admin UI
  assert(src.includes('この学生は日報を利用できる状態になっていません'), 'POST: Japanese readiness error message');
  assert(src.includes('この変更により日報を利用できない状態になります'), 'PATCH: Japanese readiness error message');
  assert(src.includes('このメールアドレスは既に登録されています'), 'POST: Japanese dup error message');
  assert(src.includes('このメールアドレスは既に他の学生に登録されています'), 'PATCH: Japanese dup error message');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n=== API source: DB write safety ===\n');
// ═══════════════════════════════════════════════════════════════════════════

{
  const src = readFileSync(new URL('../api/students.js', import.meta.url), 'utf8');

  // POST: guard path returns before createStudent
  // Extract the POST block and confirm all guard returns happen before createStudent
  const postBlock = src.match(/req\.method === 'POST'[\s\S]*?req\.method === 'PATCH'/)?.[0] || '';
  const createCallIdx = postBlock.indexOf('await createStudent(');
  // Every 'student_not_ready' and 'student_email_conflict' return precedes createStudent
  const notReadyIdx = postBlock.indexOf("code: 'student_not_ready'");
  const conflictIdx = postBlock.indexOf("code: 'student_email_conflict'");
  assert(notReadyIdx < createCallIdx, 'POST safety: student_not_ready return before createStudent');
  assert(conflictIdx < createCallIdx, 'POST safety: student_email_conflict return before createStudent');

  // PATCH: guard path returns before updateStudent
  const patchBlock = src.match(/req\.method === 'PATCH'[\s\S]*?res\.status\(405\)/)?.[0] || '';
  const updateCallIdx = patchBlock.indexOf('await updateStudent(');
  const patchNotReadyIdx = patchBlock.indexOf("code: 'student_not_ready'");
  const patchConflictIdx = patchBlock.indexOf("code: 'student_email_conflict'");
  assert(patchNotReadyIdx < updateCallIdx, 'PATCH safety: student_not_ready return before updateStudent');
  assert(patchConflictIdx < updateCallIdx, 'PATCH safety: student_email_conflict return before updateStudent');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n=== Admin readiness endpoint contract (source audit) ===\n');
// ═══════════════════════════════════════════════════════════════════════════

{
  const studentsSrc = readFileSync(new URL('../api/students.js', import.meta.url), 'utf8');

  assert(studentsSrc.includes("action === 'daily-report-readiness'"), 'endpoint: action routing');
  assert(studentsSrc.includes('handleDailyReportReadinessAudit'), 'endpoint: handler exists');
  assert(/handleDailyReportReadinessAudit[\s\S]*?role !== 'admin'/.test(studentsSrc), 'endpoint: admin-only guard');
  assert(/handleDailyReportReadinessAudit[\s\S]*?403[\s\S]*?admin_required/.test(studentsSrc), 'endpoint: 403 admin_required');
  assert(
    /handleDailyReportReadinessAudit[\s\S]*?evaluateStudentDailyReportReadinessFromStudentRow/.test(studentsSrc),
    'endpoint: uses readiness evaluator',
  );
  const handlerBody = studentsSrc.match(/async function handleDailyReportReadinessAudit[\s\S]*?\n\}/)?.[0] || '';
  assert(
    !handlerBody.includes('name:') && !handlerBody.includes('display_name:') && !handlerBody.includes('email:'),
    'endpoint: no PII in response',
  );
  assert(!handlerBody.match(/\bINSERT\b|\bUPDATE\b|\bcreateStudent\b|\bupdateStudent\b/), 'endpoint: no DB write');
  assert(handlerBody.includes('reason_counts'), 'endpoint: returns reason_counts');
  assert(handlerBody.includes('validation'), 'endpoint: returns validation field');
  assert(handlerBody.includes('normalized_email_duplicate_groups'), 'endpoint: returns dup groups');
  assert(handlerBody.includes('not_ready_details'), 'endpoint: returns not_ready_details');
  assert(studentsSrc.includes("'admin_required'"), 'endpoint: admin_required code');
  assert(!studentsSrc.includes('api/admin/'), 'endpoint: no new file');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n=== Readiness endpoint regression (fixtures) ===\n');
// ═══════════════════════════════════════════════════════════════════════════

{
  // all ready
  const allReady = [baseStudents.A];
  const readyResults = allReady.map((s) =>
    evaluateStudentDailyReportReadinessFromStudentRow({ student: s, students: allReady }),
  );
  assert(readyResults.every((r) => r.ready), 'endpoint regression: all ready → OK');

  // not-ready present
  const mixed = [baseStudents.A, baseStudents.C];
  const mixedResults = mixed.map((s) =>
    evaluateStudentDailyReportReadinessFromStudentRow({ student: s, students: mixed }),
  );
  const mixedReady = mixedResults.filter((r) => r.ready).length;
  const mixedNotReady = mixedResults.filter((r) => !r.ready).length;
  assert(mixedReady === 1, 'endpoint regression: mixed ready=1');
  assert(mixedNotReady === 1, 'endpoint regression: mixed not_ready=1');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n=== Session contract ===\n');
// ═══════════════════════════════════════════════════════════════════════════

{
  const src = readFileSync(new URL('../api/students.js', import.meta.url), 'utf8');
  assert(src.includes('requireSession(req)'), 'requireSession gates all requests');
  assert(src.includes('enrichUserFromDb(session)'), 'enrichUserFromDb gates all requests');
  const reqSessionIdx = src.indexOf('requireSession(req)');
  const actionIdx = src.indexOf("action === 'daily-report-readiness'");
  assert(reqSessionIdx < actionIdx, 'requireSession runs before action dispatch');
}

// ═══════════════════════════════════════════════════════════════════════════
// Existing 4 students regression: healthy student not rejected
console.log('\n=== Existing healthy student regression ===\n');
// ═══════════════════════════════════════════════════════════════════════════

{
  // Simulate 4 healthy production-like students
  const prodLike = [
    { id: 'p1', name: 'P1', email: 'p1@example.com', role: 'student', display_name: null, is_active: true, login_enabled: true },
    { id: 'p2', name: 'P2', email: 'p2@example.com', role: 'student', display_name: null, is_active: true, login_enabled: true },
    { id: 'p3', name: 'P3', email: 'p3@example.com', role: 'student', display_name: 'P3 Display', is_active: true, login_enabled: true },
    { id: 'p4', name: 'P4', email: 'p4@example.com', role: 'student', display_name: null, is_active: true, login_enabled: true },
  ];

  // All should be READY
  const results = prodLike.map((s) =>
    evaluateStudentDailyReportReadinessFromStudentRow({ student: s, students: prodLike }),
  );
  assert(results.every((r) => r.ready), 'prod-like 4 students: all READY');

  // Update display_name of p1 → still READY
  {
    const candidate = { ...prodLike[0], display_name: 'Updated P1' };
    const others = prodLike.filter((s) => s.id !== candidate.id);
    const result = evaluateStudentDailyReportReadinessCandidate({
      candidate,
      existingStudents: others,
    });
    assertReady(result, 'prod-like: p1 display_name update → READY');
  }

  // Update email of p1 (unique new email) → still READY
  {
    const candidate = { ...prodLike[0], email: 'p1-new@example.com' };
    const others = prodLike.filter((s) => s.id !== candidate.id);
    const result = evaluateStudentDailyReportReadinessCandidate({
      candidate,
      existingStudents: others,
    });
    assertReady(result, 'prod-like: p1 email change (unique) → READY');
  }

  // No duplicate in existing
  assert(!hasNormalizedEmailDuplicate(prodLike, 'p1@example.com', 'p1'), 'prod-like: p1 self email no dup');
  assert(!hasNormalizedEmailDuplicate(prodLike, 'new@example.com'), 'prod-like: new email no dup');
  assert(hasNormalizedEmailDuplicate(prodLike, 'p2@example.com'), 'prod-like: p2 email found');
  assert(!hasNormalizedEmailDuplicate(prodLike, 'p2@example.com', 'p2'), 'prod-like: p2 self excluded');
}

console.log(`\nStudent readiness: ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
