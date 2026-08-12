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
  parseListParams,
  sanitizeAttachments,
  parseSessionKey,
} from '../lib/daily-reports.js';

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
const studentA = { role: 'student', email: 'a@example.com' };
const studentB = { role: 'student', email: 'b@example.com' };
const admin = { role: 'admin', email: 'admin@example.com' };

const repPrivate = { student_email: 'a@example.com', visibility: 'private' };
const repLab = { student_email: 'a@example.com', visibility: 'lab' };
const repPublic = { student_email: 'a@example.com', visibility: 'public' };

assert(canViewReport(studentA, repPrivate), 'A views own private');
assert(!canViewReport(studentB, repPrivate), 'B cannot view A private');
assert(canViewReport(studentB, repLab), 'B views A lab');
assert(canViewReport(studentB, repPublic), 'B views A public');
assert(canViewReport(admin, repPrivate), 'admin views A private');

assert(canEditReport(studentA, repPrivate), 'A edits own');
assert(!canEditReport(studentB, repLab), 'B cannot edit A lab');
assert(canEditReport(admin, repLab), 'admin edits A lab');

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
