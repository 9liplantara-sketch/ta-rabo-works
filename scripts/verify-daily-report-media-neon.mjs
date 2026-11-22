/** Explicit opt-in: real Preview Neon; Blob operations are mocked. Never run on production. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const url = fs.readFileSync(process.env.PREVIEW_DATABASE_URL_FILE, 'utf8').trim();
const host = new URL(url).hostname;
assert(process.env.PREVIEW_EXPECTED_HOST && host === process.env.PREVIEW_EXPECTED_HOST, 'Explicit test host required');
process.env.DATABASE_URL = url;
process.env.BLOB_READ_WRITE_TOKEN = 'test-only-mocked-blob';
const { getDb } = await import('../lib/db.js');
const { withInteractiveTransaction: tx } = await import('../lib/db-tx.js');
const { createDailyReport } = await import('../lib/daily-reports.js');
const { syncMediaAttachmentsInTx: attach, claimAndDeleteMedia, __setBlobOpsForTest, __resetBlobOpsForTest } = await import('../lib/daily-report-media.js');
const sql = getDb();
const owner = 'bbbbbbbb-2222-4222-8222-222222222222';
const user = { studentId: owner, email: 'preview-student-a@example.com', role: 'student' };
assert.equal((await sql`SELECT count(*)::int AS n FROM students WHERE email NOT LIKE 'preview-%@example.com'`)[0].n, 0, 'Only fictional users allowed');
const mediaIds = [], reportIds = [];
let deleted = 0, passed = 0;
const ok = (label) => { passed++; console.log('PASS', label); };
__setBlobOpsForTest({ async del() { deleted++; }, async get() { throw Error('unexpected Blob read'); }, async put() { throw Error('unexpected Blob write'); } });
async function media() {
  const id = randomUUID(); mediaIds.push(id);
  await sql`INSERT INTO daily_report_media (id, owner_student_id, owner_email, blob_pathname, content_type, byte_size) VALUES (${id}, ${owner}, ${user.email}, ${'preview-db-test/' + id}, 'image/jpeg', 10)`;
  return id;
}
const attachments = (id) => [{ kind: 'media', media_id: id, type: 'image' }];
async function insertReport(client) {
  const id = randomUUID(); reportIds.push(id);
  await client.query("INSERT INTO daily_reports (id, report_date, student_id, student_name, student_email, did_today, visibility) VALUES ($1,CURRENT_DATE,$2,'Preview Student A',$3,'transaction test','private')", [id, owner, user.email]);
  return id;
}
try {
  const m1 = await media();
  const report = await createDailyReport(user, { report_date: '2026-11-22', did_today: 'Preview actual create test', visibility: 'private', attachments: attachments(m1) });
  reportIds.push(report.id);
  assert.equal((await sql`SELECT report_id FROM daily_report_media WHERE id=${m1}`)[0].report_id, report.id);
  ok('Actual createDailyReport commits report and attachment');

  const m2 = await media();
  let rolledBackId;
  await assert.rejects(tx(async client => {
    rolledBackId = await insertReport(client);
    await attach(client, user, rolledBackId, attachments(m2));
    throw Error('forced rollback');
  }), /forced rollback/);
  assert.equal((await sql`SELECT count(*)::int AS n FROM daily_reports WHERE id=${rolledBackId}`)[0].n, 0);
  assert.equal((await sql`SELECT report_id FROM daily_report_media WHERE id=${m2}`)[0].report_id, null);
  ok('Real transaction rolls back report INSERT and media UPDATE');

  let ready, release;
  const locked = new Promise(r => { ready = r; });
  const gate = new Promise(r => { release = r; });
  const attaching = tx(async client => { const id = await insertReport(client); await attach(client, user, id, attachments(m2)); ready(); await gate; });
  await locked;
  const purging = claimAndDeleteMedia(m2, { unusedOnly: true });
  release();
  await attaching;
  assert.equal((await purging).reason, 'claim_failed');
  assert.equal(deleted, 0);
  ok('Concurrent purge loses to committed attachment; Blob not deleted');

  const m3 = await media();
  assert.equal((await claimAndDeleteMedia(m3, { unusedOnly: true })).ok, true);
  let rejectedId;
  await assert.rejects(tx(async client => { rejectedId = await insertReport(client); await attach(client, user, rejectedId, attachments(m3)); }), e => e.status === 409);
  assert.equal((await sql`SELECT count(*)::int AS n FROM daily_reports WHERE id=${rejectedId}`)[0].n, 0);
  ok('Deletion first causes attachment 409 and rolls back report');
  console.log(`${passed} passed; real Neon, mocked Blob; HTTP and browser not covered`);
} finally {
  __resetBlobOpsForTest();
  for (const id of mediaIds) await sql`DELETE FROM daily_report_media WHERE id=${id}`;
  for (const id of reportIds) await sql`DELETE FROM daily_reports WHERE id=${id}`;
}
