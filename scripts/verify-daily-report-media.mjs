#!/usr/bin/env node
/**
 * 日報直接画像アップロード — ローカル単体検証（実 DB/Blob 不要）
 */
import sharp from 'sharp';
import {
  detectImageContentType,
  validateUploadBuffer,
  MEDIA_LIMITS,
  VERCEL_FUNCTION_BODY_LIMIT_BYTES,
  mediaOwnedByUser,
  canDeleteMedia,
  canViewMedia,
  estimateBase64JsonUploadBytes,
  estimateRawUploadBytes,
  uploadFitsVercelLimit,
  normalizeAndValidateImage,
  isMediaEligibleForPurge,
  SERVER_METADATA_POLICY,
} from '../lib/daily-report-media.js';
import { sanitizeAttachments, canViewReport } from '../lib/daily-reports.js';

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

function jpegMagic(size = 32) {
  const buf = Buffer.alloc(size, 0);
  buf[0] = 0xff;
  buf[1] = 0xd8;
  buf[2] = 0xff;
  buf[3] = 0xe0;
  return buf;
}

function pngMagic() {
  return Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
}

function webpMagic() {
  const b = Buffer.alloc(12, 0);
  b.write('RIFF', 0);
  b.write('WEBP', 8);
  return b;
}

function heicMagic() {
  const b = Buffer.alloc(16, 0);
  b[4] = 0x66; b[5] = 0x74; b[6] = 0x79; b[7] = 0x70;
  b.write('heic', 8);
  return b;
}

async function makeJpeg(width, height, { withExifOrientation = false } = {}) {
  let img = sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 40, g: 120, b: 200 },
    },
  }).jpeg({ quality: 80 });
  if (withExifOrientation) {
    // EXIF 付きでも normalize 後はメタが落ち、向きが反映される
    img = sharp(await img.toBuffer()).withMetadata({ orientation: 6 }).jpeg({ quality: 80 });
  }
  return img.toBuffer();
}

console.log('\n=== daily-report-media: magic bytes ===\n');
assert(detectImageContentType(jpegMagic()) === 'image/jpeg', 'JPEG detect');
assert(detectImageContentType(pngMagic()) === 'image/png', 'PNG detect');
assert(detectImageContentType(webpMagic()) === 'image/webp', 'WebP detect');
assert(detectImageContentType(heicMagic()) === 'image/heic', 'HEIC detect');
assert(detectImageContentType(Buffer.from([1, 2, 3, 4])) === null, 'unknown → null');

console.log('\n=== daily-report-media: validateUploadBuffer ===\n');
assert(validateUploadBuffer(jpegMagic()).ok === true, 'JPEG magic ok (pre-decode)');
assert(validateUploadBuffer(heicMagic()).ok === false, 'HEIC rejected');
assert(validateUploadBuffer(heicMagic()).code === 'heic_unsupported', 'HEIC code');
assert(validateUploadBuffer(Buffer.alloc(0)).ok === false, 'empty rejected');
const huge = jpegMagic(MEDIA_LIMITS.maxBytes + 10);
assert(validateUploadBuffer(huge).ok === false, 'oversize rejected');
assert(validateUploadBuffer(huge).status === 413, 'oversize 413');
assert(
  validateUploadBuffer(jpegMagic(), 'image/png').ok === false,
  'claimed type mismatch rejected',
);
assert(
  validateUploadBuffer(jpegMagic(), 'image/jpg').ok === true,
  'image/jpg alias accepted for JPEG',
);

console.log('\n=== payload size: Base64 vs raw vs Vercel 4.5MiB ===\n');
assert(VERCEL_FUNCTION_BODY_LIMIT_BYTES === Math.floor(4.5 * 1024 * 1024), 'vercel limit constant');
assert(MEDIA_LIMITS.maxBytes === Math.floor(3.5 * 1024 * 1024), 'maxBytes 3.5MiB');
const nearOld = 4 * 1024 * 1024;
const thumbEst = 80 * 1024;
assert(
  !uploadFitsVercelLimit(nearOld, { mode: 'base64', thumbBytes: thumbEst }),
  '旧: 4MiB+thumb の Base64 JSON は 4.5MiB 超過',
);
assert(
  uploadFitsVercelLimit(MEDIA_LIMITS.maxBytes, { mode: 'raw' }),
  '新: 3.5MiB raw は 4.5MiB 内',
);
assert(
  estimateBase64JsonUploadBytes(nearOld, thumbEst) > VERCEL_FUNCTION_BODY_LIMIT_BYTES,
  'Base64 推定が上限超',
);
assert(
  estimateRawUploadBytes(MEDIA_LIMITS.maxBytes) < VERCEL_FUNCTION_BODY_LIMIT_BYTES,
  'raw 推定が上限未満',
);

console.log('\n=== sharp normalize / dimensions (client dims ignored) ===\n');
{
  const real = await makeJpeg(120, 80);
  const norm = await normalizeAndValidateImage(real, 'image/jpeg');
  assert(norm.ok === true, 'decodable jpeg ok');
  assert(norm.width === 120 && norm.height === 80, 'server-measured dims');
  assert(Buffer.isBuffer(norm.thumbBuffer) && norm.thumbBuffer.length > 0, 'thumb generated');
  // メタ除去: 出力に orientation が残らないこと
  const outMeta = await sharp(norm.buffer).metadata();
  assert(!outMeta.orientation, 'EXIF orientation stripped after normalize');
}
{
  const garbage = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08]);
  const bad = await normalizeAndValidateImage(garbage, 'image/jpeg');
  assert(bad.ok === false, 'undecodable jpeg rejected');
}
{
  const wide = await makeJpeg(3000, 1000);
  const norm = await normalizeAndValidateImage(wide, 'image/jpeg');
  assert(norm.ok === true, 'oversized edge resized');
  assert(Math.max(norm.width, norm.height) <= MEDIA_LIMITS.maxEdgePx, 'edge within limit');
}
assert(typeof SERVER_METADATA_POLICY === 'string' && SERVER_METADATA_POLICY.includes('sharp'), 'metadata policy documented');

console.log('\n=== daily-reports: sanitizeAttachments media + url ===\n');
const mediaId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const sanitized = sanitizeAttachments([
  { kind: 'media', media_id: mediaId, note: '実験装置', title: 'photo1' },
  { kind: 'media', media_id: 'not-a-uuid', note: 'bad' },
  { url: 'https://drive.google.com/file/d/x', type: 'pdf', note: '資料' },
  { url: 'javascript:alert(1)', type: 'other' },
  { url: 'ftp://example.com/a', type: 'other' },
]);
assert(sanitized.length === 2, 'keeps media + https only');
assert(sanitized[0].kind === 'media' && sanitized[0].media_id === mediaId, 'media shape');
assert(sanitized[0].type === 'image', 'media type forced to image');
assert(sanitized[1].url.startsWith('https://') && sanitized[1].type === 'pdf', 'url attach kept');

const many = sanitizeAttachments(
  Array.from({ length: 25 }, (_, i) => ({
    url: `https://example.com/${i}.pdf`,
    type: 'pdf',
  })),
);
assert(many.length === 20, 'max 20 attachments');

console.log('\n=== visibility / ownership / purge eligibility ===\n');
const owner = { role: 'student', email: 'a@example.com', studentId: '11111111-1111-1111-1111-111111111111' };
const other = { role: 'student', email: 'b@example.com', studentId: '22222222-2222-2222-2222-222222222222' };
const admin = { role: 'admin', email: 't@example.com' };
const mediaRow = {
  id: mediaId,
  owner_student_id: owner.studentId,
  owner_email: owner.email,
  status: 'pending',
  report_id: null,
  updated_at: new Date(Date.now() - 48 * 3600 * 1000).toISOString(),
};
assert(mediaOwnedByUser(owner, mediaRow), 'owner owns pending');
assert(!mediaOwnedByUser(other, mediaRow), 'other does not own');
assert(mediaOwnedByUser(admin, mediaRow), 'admin owns');
assert(canDeleteMedia(owner, mediaRow), 'owner can delete pending');
assert(!canDeleteMedia(other, mediaRow), 'other cannot delete');

const privateReport = {
  student_id: owner.studentId,
  student_email: owner.email,
  visibility: 'private',
};
assert(canViewReport(owner, privateReport), 'owner views private');
assert(!canViewReport(other, privateReport), 'other cannot view private');
assert(canViewReport(admin, privateReport), 'admin views private');
assert(
  canViewReport(other, { ...privateReport, visibility: 'lab' }),
  'lab visible to logged-in lab member path (API session required)',
);
assert(
  canViewReport(other, { ...privateReport, visibility: 'public' }),
  'public still requires session via API (not anonymous)',
);

const pendingViewOwner = await canViewMedia(owner, mediaRow);
const pendingViewOther = await canViewMedia(other, mediaRow);
assert(pendingViewOwner === true, 'canViewMedia pending owner');
assert(pendingViewOther === false, 'canViewMedia pending other denied');

assert(isMediaEligibleForPurge(mediaRow, { olderThanHours: 24 }), 'old pending purgeable');
assert(
  !isMediaEligibleForPurge({ ...mediaRow, status: 'attached', report_id: 'r1' }, { olderThanHours: 24 }),
  'attached not purgeable',
);
assert(
  !isMediaEligibleForPurge({ ...mediaRow, report_id: 'r1', status: 'orphaned' }, { olderThanHours: 24 }),
  'report_id set not purgeable',
);
assert(
  !isMediaEligibleForPurge({
    ...mediaRow,
    updated_at: new Date().toISOString(),
  }, { olderThanHours: 24 }),
  'fresh pending not purgeable',
);
assert(
  !isMediaEligibleForPurge({
    ...mediaRow,
    status: 'deleting',
    updated_at: new Date().toISOString(),
  }, { olderThanHours: 24, reclaimMinutes: 15 }),
  'fresh deleting not purgeable yet',
);
assert(
  isMediaEligibleForPurge({
    ...mediaRow,
    status: 'deleting',
    updated_at: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
  }, { olderThanHours: 24, reclaimMinutes: 15 }),
  'stale deleting reclaimable',
);

console.log('\n=== limits constants ===\n');
assert(MEDIA_LIMITS.maxFilesPerReport === 12, 'max 12 files');
assert(MEDIA_LIMITS.allowedContentTypes.includes('image/jpeg'), 'jpeg allowed');
assert(MEDIA_LIMITS.allowedContentTypes.includes('image/png'), 'png allowed');
assert(MEDIA_LIMITS.allowedContentTypes.includes('image/webp'), 'webp allowed');
assert(!MEDIA_LIMITS.allowedContentTypes.includes('image/heic'), 'heic not allowed');

console.log(`\nUnit result: ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
