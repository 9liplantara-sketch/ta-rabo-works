#!/usr/bin/env node
/**
 * 日報画像 — 実 delete/purge/claim 関数へ DB・Blob を差し替えて検証。
 * CORS preflight（別 origin）も検証。
 *
 * 本番（実 Blob / 実 Neon / 実ブラウザ E2E）は未実施。
 */
import {
  __setBlobOpsForTest,
  __resetBlobOpsForTest,
  __setMediaDbForTest,
  __resetMediaDbForTest,
  createMemoryMediaDb,
  claimAndDeleteMedia,
  deleteMedia,
  finalizeClaimedMediaDeletion,
  purgeExpiredUnusedMedia,
  syncMediaAttachmentsInTx,
  MEDIA_DELETE_RECLAIM_MINUTES,
} from '../lib/daily-report-media.js';
import { applyCors, handleOptions, appendVary, CORS_ALLOW_HEADERS } from '../lib/cors.js';
import { withCors } from '../lib/http.js';

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

function mockRes() {
  const headers = {};
  return {
    headers,
    statusCode: 200,
    setHeader(k, v) {
      headers[String(k).toLowerCase()] = v;
    },
    getHeader(k) {
      return headers[String(k).toLowerCase()];
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    end() {},
    json() {},
    send() {},
  };
}

function mockUser() {
  return {
    role: 'student',
    email: 'test-media@example.com',
    studentId: '11111111-1111-1111-1111-111111111111',
  };
}

function oldIso(hoursAgo) {
  return new Date(Date.now() - hoursAgo * 3600 * 1000).toISOString();
}

function seedPending(mem, overrides = {}) {
  const id = overrides.id || 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  mem.seed({
    id,
    report_id: null,
    owner_student_id: mockUser().studentId,
    owner_email: mockUser().email,
    blob_pathname: `daily-reports/u/${id}-full.jpg`,
    thumb_pathname: `daily-reports/u/${id}-thumb.jpg`,
    content_type: 'image/jpeg',
    byte_size: 1000,
    width: 10,
    height: 10,
    original_filename: 't.jpg',
    caption: null,
    client_upload_key: null,
    delete_claim_token: null,
    status: 'pending',
    created_at: oldIso(48),
    updated_at: oldIso(48),
    ...overrides,
  });
  return id;
}

function attachClientFromMemory(mem) {
  return {
    async query(sql, params) {
      const s = String(sql);
      if (s.includes('SET report_id') && s.includes('RETURNING id')) {
        const reportId = params[0];
        const mid = params[1];
        const ownerStudentId = params[2];
        const isAdmin = params[3];
        const ok = await mem.tryAttach(mid, reportId, { ownerStudentId, isAdmin });
        return { rowCount: ok ? 1 : 0, rows: ok ? [{ id: mid }] : [] };
      }
      if (s.includes("status = 'orphaned'")) {
        return { rowCount: 0, rows: [] };
      }
      return { rowCount: 0, rows: [] };
    },
  };
}

console.log('\n=== CORS: 別 origin OPTIONS で追加ヘッダ許可 ===\n');
{
  const origin = 'https://works.ta-rabo.com';
  const optRes = mockRes();
  handleOptions({
    method: 'OPTIONS',
    headers: {
      origin,
      'access-control-request-method': 'POST',
      'access-control-request-headers':
        'content-type,authorization,x-client-upload-key,x-filename,x-caption',
    },
  }, optRes);
  assert(optRes.statusCode === 204, 'OPTIONS → 204');
  assert(optRes.headers['access-control-allow-origin'] === origin, 'Allow-Origin = works');
  const allow = String(optRes.headers['access-control-allow-headers'] || '').toLowerCase();
  assert(allow.includes('x-client-upload-key'), 'Allow X-Client-Upload-Key');
  assert(allow.includes('x-filename'), 'Allow X-Filename');
  assert(allow.includes('x-caption'), 'Allow X-Caption');
  assert(allow.includes('authorization'), 'Allow Authorization');
  assert(String(CORS_ALLOW_HEADERS).includes('X-Client-Upload-Key'), 'CORS_ALLOW_HEADERS constant');

  const denied = mockRes();
  applyCors({ method: 'OPTIONS', headers: { origin: 'https://evil.example' } }, denied);
  assert(denied.headers['access-control-allow-origin'] == null, 'unknown origin denied');

  // Vary: Origin を保持したまま Authorization を追加
  const getRes = mockRes();
  applyCors({ method: 'GET', headers: { origin } }, getRes);
  appendVary(getRes, 'Authorization');
  const vary = String(getRes.headers.vary || '');
  assert(vary.includes('Origin'), 'Vary keeps Origin');
  assert(vary.includes('Authorization'), 'Vary adds Authorization');

  // withCors 経由の OPTIONS → ハンドラ前に 204
  let handlerCalled = false;
  const wrapped = withCors(async () => {
    handlerCalled = true;
  });
  const wRes = mockRes();
  await wrapped({
    method: 'OPTIONS',
    headers: {
      origin,
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'x-client-upload-key,x-filename,x-caption',
    },
  }, wRes);
  assert(wRes.statusCode === 204, 'withCors OPTIONS 204');
  assert(!handlerCalled, 'OPTIONS does not hit handler');
  assert(
    String(wRes.headers['access-control-allow-headers'] || '').toLowerCase().includes('x-caption'),
    'withCors OPTIONS allows X-Caption',
  );
}

console.log('\n=== 実関数: 候補取得後に添付が先 → Blob を削除しない ===\n');
{
  const mem = createMemoryMediaDb();
  const id = seedPending(mem);
  __setMediaDbForTest(mem);
  const deleted = [];
  __setBlobOpsForTest({
    async del(p) { deleted.push(p); },
    async put() { return { pathname: 'x', url: 'x' }; },
    async get() { return null; },
  });
  process.env.BLOB_READ_WRITE_TOKEN = process.env.BLOB_READ_WRITE_TOKEN || 'test-token';

  // 候補に見える状態のあと、添付確定が勝つ
  assert(mem.get(id).status === 'pending', 'starts pending');
  const attached = await mem.tryAttach(id, 'report-win', {
    ownerStudentId: mockUser().studentId,
  });
  assert(attached === true, 'attach wins before purge claim');

  const result = await claimAndDeleteMedia(id, {
    unusedOnly: true,
    olderThanHours: 24,
  });
  assert(result.ok === false && result.skipped === true, 'purge claim skipped');
  assert(deleted.length === 0, 'Blob del not called');
  assert(mem.get(id).status === 'attached', 'still attached');
  assert(mem.get(id).blob_pathname, 'blob pathname retained');

  __resetBlobOpsForTest();
  __resetMediaDbForTest();
}

console.log('\n=== 実関数: 削除確保が先 → 添付失敗（日報 TX は 409 でロールバック想定） ===\n');
{
  const mem = createMemoryMediaDb();
  const id = seedPending(mem);
  __setMediaDbForTest(mem);
  const deleted = [];
  __setBlobOpsForTest({
    async del(p) { deleted.push(String(p)); },
    async put() { return { pathname: 'x', url: 'x' }; },
    async get() { return null; },
  });
  process.env.BLOB_READ_WRITE_TOKEN = process.env.BLOB_READ_WRITE_TOKEN || 'test-token';

  const claimed = await mem.claimForDeletion({
    mediaId: id,
    unusedOnly: true,
    olderThanHours: 24,
  });
  assert(claimed && claimed.status === 'deleting', 'atomic claim → deleting');

  let attachErr = null;
  try {
    await syncMediaAttachmentsInTx(
      attachClientFromMemory(mem),
      mockUser(),
      'report-lose',
      [{ kind: 'media', media_id: id }],
    );
  } catch (e) {
    attachErr = e;
  }
  assert(attachErr?.status === 409, 'attach fails with 409');
  assert(attachErr?.code === 'media_already_attached', 'media_already_attached / not attachable');
  assert(mem.get(id).status === 'deleting', 'remains deleting');
  assert(mem.get(id).report_id == null, 'not attached to report');

  // 確保後の finalize で Blob 削除
  await finalizeClaimedMediaDeletion(mem.get(id));
  assert(mem.get(id) == null, 'row removed after finalize');
  assert(deleted.some((d) => d.includes('-full.')), 'full blob deleted');
  assert(deleted.some((d) => d.includes('-thumb.')), 'thumb blob deleted');

  __resetBlobOpsForTest();
  __resetMediaDbForTest();
}

console.log('\n=== 実関数: Blob 削除失敗後も再試行情報が残る ===\n');
{
  const mem = createMemoryMediaDb();
  const id = seedPending(mem);
  __setMediaDbForTest(mem);
  __setBlobOpsForTest({
    async del() {
      throw new Error('blob unavailable');
    },
    async put() { return { pathname: 'x', url: 'x' }; },
    async get() { return null; },
  });
  process.env.BLOB_READ_WRITE_TOKEN = process.env.BLOB_READ_WRITE_TOKEN || 'test-token';

  let err = null;
  try {
    await deleteMedia(mockUser(), id);
  } catch (e) {
    err = e;
  }
  assert(err?.code === 'blob_delete_failed', 'blob_delete_failed');
  assert(err?.retryable === true, 'retryable');
  const row = mem.get(id);
  assert(row?.status === 'delete_failed', 'status delete_failed');
  assert(row?.blob_pathname?.includes('-full.'), 'pathname kept for retry');
  assert(row?.thumb_pathname?.includes('-thumb.'), 'thumb pathname kept');

  // 再試行: Blob が直れば削除完了
  __setBlobOpsForTest({
    async del() { /* ok */ },
    async put() { return { pathname: 'x', url: 'x' }; },
    async get() { return null; },
  });
  const retry = await deleteMedia(mockUser(), id);
  assert(retry.ok === true, 'retry delete succeeds');
  assert(mem.get(id) == null, 'row gone after retry');

  __resetBlobOpsForTest();
  __resetMediaDbForTest();
}

console.log('\n=== 実関数: 古い claim は新しい確保の状態を変更できない ===\n');
{
  const mem = createMemoryMediaDb();
  const id = seedPending(mem);
  __setMediaDbForTest(mem);
  __setBlobOpsForTest({
    async del() { /* ok */ },
    async put() { return { pathname: 'x', url: 'x' }; },
    async get() { return null; },
  });
  process.env.BLOB_READ_WRITE_TOKEN = process.env.BLOB_READ_WRITE_TOKEN || 'test-token';

  const oldClaim = await mem.claimForDeletion({
    mediaId: id,
    unusedOnly: true,
    olderThanHours: 24,
    now: Date.now() - 20 * 60 * 1000,
  });
  // 確保時刻を古く見せて再確保可能にする
  mem.seed({
    ...mem.get(id),
    updated_at: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
  });
  const oldToken = oldClaim.delete_claim_token;
  assert(!!oldToken, 'old claim has token');

  const newClaim = await mem.claimForDeletion({
    mediaId: id,
    unusedOnly: true,
    olderThanHours: 24,
    reclaimMinutes: 15,
    now: Date.now(),
  });
  assert(!!newClaim?.delete_claim_token, 'new claim has token');
  assert(
    String(newClaim.delete_claim_token) !== String(oldToken),
    'new claim_token differs from old',
  );
  assert(mem.get(id).status === 'deleting', 'still deleting under new claim');

  const marked = await mem.markDeleteFailed(id, oldToken);
  assert(marked === false, 'old markDeleteFailed rejected');
  assert(mem.get(id).status === 'deleting', 'status unchanged by old markDeleteFailed');
  assert(
    String(mem.get(id).delete_claim_token) === String(newClaim.delete_claim_token),
    'new token unchanged after old markDeleteFailed',
  );

  const removed = await mem.removeClaimed(id, oldToken);
  assert(removed === false, 'old removeClaimed rejected');
  assert(mem.get(id) != null, 'row still present after old removeClaimed');

  // finalize も古い claim では superseded
  const fin = await finalizeClaimedMediaDeletion({
    ...oldClaim,
    status: 'deleting',
    delete_claim_token: oldToken,
  });
  assert(fin.skipped === true && fin.reason === 'claim_superseded', 'old finalize superseded');
  assert(mem.get(id)?.status === 'deleting', 'row still deleting for new claim');
  assert(
    String(mem.get(id).delete_claim_token) === String(newClaim.delete_claim_token),
    'new token intact after old finalize',
  );

  // 新しい確保は正常完了できる
  const ok = await finalizeClaimedMediaDeletion(newClaim);
  assert(ok.ok === true, 'new finalize succeeds');
  assert(mem.get(id) == null, 'row removed by new claim only');

  __resetBlobOpsForTest();
  __resetMediaDbForTest();
}

console.log('\n=== 実関数: purgeExpiredUnusedMedia（候補→claim）と添付競合 ===\n');
{
  const mem = createMemoryMediaDb();
  const idOld = seedPending(mem, {
    id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    updated_at: oldIso(48),
  });
  const idRace = seedPending(mem, {
    id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
    updated_at: oldIso(48),
  });
  __setMediaDbForTest(mem);
  const deleted = [];
  __setBlobOpsForTest({
    async del(p) { deleted.push(String(p)); },
    async put() { return { pathname: 'x', url: 'x' }; },
    async get() { return null; },
  });
  process.env.BLOB_READ_WRITE_TOKEN = process.env.BLOB_READ_WRITE_TOKEN || 'test-token';

  // 候補取得相当のあと、idRace だけ添付が先
  await mem.tryAttach(idRace, 'report-race', { ownerStudentId: mockUser().studentId });

  const out = await purgeExpiredUnusedMedia(mockUser(), {
    olderThanHours: 24,
    candidateIds: [idOld, idRace],
  });
  assert(out.purged === 1, 'one purged');
  const raceResult = out.results.find((r) => r.id === idRace);
  assert(raceResult?.skipped === true, 'attached candidate skipped by claim');
  assert(mem.get(idRace)?.status === 'attached', 'raced media still attached');
  assert(mem.get(idOld) == null, 'old unused removed');
  assert(
    deleted.some((d) => d.includes(idOld)) && !deleted.some((d) => d.includes(idRace)),
    'only unattached media blobs deleted',
  );
  assert(MEDIA_DELETE_RECLAIM_MINUTES >= 1, 'reclaim minutes configured');

  __resetBlobOpsForTest();
  __resetMediaDbForTest();
}

console.log('\n=== 未実施（メモリDBでは検証済みと扱わない） ===\n');
console.log('  · 日報本文×画像紐付けの実 Neon interactive transaction / ロールバック');
console.log('  · Preview 等での raw binary 受信・画像表示');
console.log('  · 実 Vercel 上の OPTIONS→POST（works.ta-rabo.com → API）');
console.log('  · 本人／別学生／教員／未ログインの閲覧権限 E2E');
console.log('  · 公開範囲変更・ログアウト・アカウント切替');
console.log('  · スマホ実機の選択・投稿・再試行');

console.log(`\nIntegration result: ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
