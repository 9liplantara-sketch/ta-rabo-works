#!/usr/bin/env node
/**
 * Phase 5D — student identity / longitudinal linkage
 *
 *   npm run verify:member-analysis-phase5d-student-identity
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  EMAIL_HEADER_CANDIDATES,
  STUDENT_MATCH_METHODS,
  classifyStudentMatch,
  detectHeaderFromCandidates,
  evaluateStudentIdentityInputs,
  isUnlinkedStudentMatchMethod,
  normalizeEmail,
  normalizePersonName,
} from '../lib/member-analysis-student-identity.js';
import { resolveStudentMatchFromList } from '../lib/psych-assessments.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const gasCodePath = path.join(__dirname, '../gas/member-analysis-sync/Code.gs');
const psychPath = path.join(__dirname, '../lib/psych-assessments.js');
const hashPath = path.join(__dirname, '../lib/member-analysis-sync-hash-v3.js');

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

const roster = [
  { id: 's-kin', name: '木下 涼', email: 'kin@example.com' },
  { id: 's-taki', name: '滝本 陽也', email: 'taki@example.com' },
];

console.log('\n=== Phase 5D: normalizeEmail ===\n');

assert(normalizeEmail(' Student@Example.AC.JP ') === 'student@example.ac.jp', 'trim+lowercase');
assert(normalizeEmail('') === null, 'empty → null');
assert(normalizeEmail(null) === null, 'null → null');
assert(normalizeEmail('   ') === null, 'whitespace → null');
assert(normalizePersonName('滝本　陽也') === normalizePersonName('滝本 陽也'), 'name NFKC still works');

console.log('\n=== Phase 5D: email match ===\n');

assert(
  classifyStudentMatch({
    respondentEmail: 'KIN@example.com',
    respondentName: '誰か',
    students: roster,
  }).matchMethod === STUDENT_MATCH_METHODS.EMAIL,
  'exact email (case-insensitive) → email',
);

assert(
  classifyStudentMatch({
    respondentEmail: 'nobody@example.com',
    respondentName: '滝本陽也',
    students: roster,
  }).matchMethod === STUDENT_MATCH_METHODS.UNMATCHED_EMAIL,
  '0 email candidates → unmatched_email',
);

const ambiguousEmail = classifyStudentMatch({
  respondentEmail: 'dup@example.com',
  respondentName: '誰か',
  students: [
    { id: 'a', name: 'A', email: 'Dup@Example.com' },
    { id: 'b', name: 'B', email: 'dup@example.com' },
  ],
});
assert(ambiguousEmail.matchMethod === STUDENT_MATCH_METHODS.AMBIGUOUS_EMAIL, '2 email candidates → ambiguous_email');
assert(ambiguousEmail.studentId === null, 'ambiguous_email studentId null');

console.log('\n=== Phase 5D: no unsafe name fallback ===\n');

const unsafe = classifyStudentMatch({
  respondentEmail: 'missing@example.com',
  respondentName: '滝本陽也',
  students: roster,
});
assert(unsafe.matchMethod === STUDENT_MATCH_METHODS.UNMATCHED_EMAIL, 'email present + 0 match → unmatched_email');
assert(unsafe.studentId === null, 'does NOT assign name match student_id');
assert(unsafe.matchMethod !== STUDENT_MATCH_METHODS.NAME, 'NOT matched_name');

const viaResolve = resolveStudentMatchFromList({
  respondentEmail: 'missing@example.com',
  respondentName: '滝本陽也',
  students: roster,
});
assert(viaResolve.matchMethod === 'unmatched_email', 'resolveStudentMatchFromList same policy');

console.log('\n=== Phase 5D: name fallback only when email missing ===\n');

assert(
  classifyStudentMatch({
    respondentEmail: null,
    respondentName: '滝本陽也',
    students: roster,
  }).matchMethod === STUDENT_MATCH_METHODS.NAME,
  'email blank + name 1 → name',
);

assert(
  classifyStudentMatch({
    respondentEmail: '',
    respondentName: '存在しない人',
    students: roster,
  }).matchMethod === STUDENT_MATCH_METHODS.UNMATCHED_NAME,
  'email blank + name 0 → unmatched_name',
);

assert(
  classifyStudentMatch({
    respondentEmail: null,
    respondentName: '山田太郎',
    students: [
      { id: 'dup-a', name: '山田 太郎', email: 'a@example.com' },
      { id: 'dup-b', name: '山田太郎', email: 'b@example.com' },
    ],
  }).matchMethod === STUDENT_MATCH_METHODS.AMBIGUOUS_NAME,
  'email blank + name 2 → ambiguous_name',
);

console.log('\n=== Phase 5D: student number does not auto-match ===\n');

const withAdm02 = classifyStudentMatch({
  respondentEmail: null,
  respondentName: null,
  students: roster,
});
assert(withAdm02.studentId === null, 'ADM-02 alone cannot assign student_id');
assert(isUnlinkedStudentMatchMethod('unmatched_email'), 'unmatched_email is unlinked status');
assert(isUnlinkedStudentMatchMethod('ambiguous_email'), 'ambiguous_email is unlinked status');
assert(!isUnlinkedStudentMatchMethod('email'), 'email is linked status');

console.log('\n=== Phase 5D: identity input diagnostic ===\n');

assert(
  evaluateStudentIdentityInputs({
    formCollectsEmail: true,
    emailColumnDetected: true,
    emailPopulatedRows: 4,
    responseRows: 4,
  }).validation === 'PASS',
  'Form collects + Sheet detected → PASS',
);

const failDetect = evaluateStudentIdentityInputs({
  formCollectsEmail: true,
  emailColumnDetected: false,
  emailPopulatedRows: 0,
  responseRows: 4,
});
assert(failDetect.validation === 'FAIL', 'Form collects + Sheet missing → FAIL');
assert(
  failDetect.reason === 'form_collects_email_but_sheet_email_column_not_detected',
  'missing sheet email reason',
);

const infoNoCollect = evaluateStudentIdentityInputs({
  formCollectsEmail: false,
  emailColumnDetected: false,
  emailPopulatedRows: 0,
  responseRows: 4,
});
assert(infoNoCollect.validation === 'PASS', 'Form no collect + sheet absent → PASS');
assert(infoNoCollect.warnings.length >= 1, 'Form no collect → WARN/INFO');

const emptyWarn = evaluateStudentIdentityInputs({
  formCollectsEmail: true,
  emailColumnDetected: true,
  emailPopulatedRows: 0,
  responseRows: 4,
});
assert(emptyWarn.validation === 'PASS', 'column present but empty → PASS with WARN');
assert(emptyWarn.warnings.some((w) => w.includes('all response emails are empty')), 'empty email WARN');

assert(
  detectHeaderFromCandidates({ メールアドレス: 3, 氏名: 2 }, EMAIL_HEADER_CANDIDATES) === 'メールアドレス',
  'detect メールアドレス header',
);
assert(
  detectHeaderFromCandidates({ 'Email Address': 1 }, EMAIL_HEADER_CANDIDATES) === 'Email Address',
  'detect Email Address header',
);

console.log('\n=== Phase 5D: isolation ===\n');

const hashLib = fs.readFileSync(hashPath, 'utf8');
const psychCode = fs.readFileSync(psychPath, 'utf8');
const schema = fs.readFileSync(path.join(__dirname, '../db/schema.sql'), 'utf8');
assert(!hashLib.includes('respondent_email'), 'stable hash lib does not use respondent_email');
assert(!hashLib.includes('student_id'), 'stable hash lib does not use student_id');
assert(psychCode.includes('classifyStudentMatch'), 'psych uses classifyStudentMatch');
assert(psychCode.includes('isUnlinkedStudentMatchMethod'), 'psych maps unlinked match methods');
assert(!schema.includes('student_number'), 'no student_number column');
assert(!schema.includes('finalized_at'), 'no finalized_at from 5D');

console.log('\n=== Phase 5D: GAS markers ===\n');

const gasCode = fs.readFileSync(gasCodePath, 'utf8');
assert(gasCode.includes('previewMemberAnalysisStudentIdentityInputs'), 'GAS identity preview');
assert(gasCode.includes('学生ID入力監査'), 'GAS menu item');
assert(gasCode.includes('form_collects_email_but_sheet_email_column_not_detected'), 'GAS fail reason');
assert(gasCode.includes('student matched:'), 'GAS sync summary match counts');
assert(gasCode.includes("META_HEADERS.email"), 'GAS uses META_HEADERS.email');
assert(gasCode.includes("'メールアドレス'"), 'GAS email header candidate');

console.log(`\nPhase 5D: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
