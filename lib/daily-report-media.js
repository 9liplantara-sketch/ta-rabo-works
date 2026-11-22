/**
 * 日報画像アップロード — Vercel Blob (private) + Neon メタデータ
 *
 * 送信: 関数ボディ上限 4.5MiB 内の raw binary（Base64 不使用）。
 * サーバー: sharp でデコード・寸法検証・向き反映・メタ除去・サムネ生成。
 * 紐付け: 条件付き UPDATE + interactive transaction。
 */

import { put, del, get } from '@vercel/blob';
import sharp from 'sharp';
import { getDb } from './db.js';
import { canViewReport, findDailyReportById, reportOwnedByUser } from './daily-reports.js';

/** Vercel Functions のリクエストボディ上限（公式 4.5 MB） */
export const VERCEL_FUNCTION_BODY_LIMIT_BYTES = Math.floor(4.5 * 1024 * 1024);

/**
 * 画像ファイル本体の上限。raw binary 送信のため Base64 膨張なし。
 * フォームフィールド／ヘッダ余裕を見て 4.5MiB 未満に抑える。
 */
export const MEDIA_LIMITS = {
  maxFilesPerReport: 12,
  maxBytes: Math.floor(3.5 * 1024 * 1024),
  maxEdgePx: 2400,
  maxPixels: 2400 * 2400,
  thumbEdgePx: 480,
  maxThumbBytes: 350 * 1024,
  allowedContentTypes: ['image/jpeg', 'image/png', 'image/webp'],
  vercelBodyLimitBytes: VERCEL_FUNCTION_BODY_LIMIT_BYTES,
};

const HEIC_HINT =
  'この端末の HEIC/HEIF はそのままでは保存できません。写真アプリで JPEG に書き出するか、カメラロールから選ぶと JPEG になることが多いです。';

/** ブラウザ再エンコードを迂回した場合: sharp で向き反映・EXIF/GPS 除去してから保存する */
export const SERVER_METADATA_POLICY =
  'クライアント処理を迂回しても、サーバーが sharp でデコードし向きを反映したうえでメタデータを除去して再エンコードします。デコード不能・寸法超過は拒否します。';

let mediaTableReadyCache = null;

/** @type {{ put: typeof put, del: typeof del, get: typeof get }} */
let blobOps = { put, del, get };

/** テスト用: Blob / sharp 操作の差し替え */
export function __setBlobOpsForTest(ops) {
  blobOps = { put, del, get, ...ops };
}

export function __resetBlobOpsForTest() {
  blobOps = { put, del, get };
}

/** テスト用: テーブル準備済みフラグ */
export function __setMediaTableReadyForTest(value) {
  mediaTableReadyCache = value;
}

/** 削除確保のスタック回収（分）。プロセス中断後の再試行用 */
export const MEDIA_DELETE_RECLAIM_MINUTES = 15;

/** 添付確定可能な status（deleting / delete_failed は不可） */
export const ATTACHABLE_MEDIA_STATUSES = ['pending', 'orphaned', 'attached'];

/**
 * @typedef {object} MediaDb
 * @property {(id: string) => Promise<object|null>} findById
 * @property {(opts: object) => Promise<object|null>} claimForDeletion
 * @property {(id: string, claimToken: string) => Promise<boolean>} markDeleteFailed
 * @property {(id: string, claimToken: string) => Promise<boolean>} removeClaimed
 */

function newDeleteClaimToken() {
  return crypto.randomUUID();
}

/** @type {MediaDb|null} */
let mediaDbOverride = null;

/** テスト用: Neon の代わりにインメモリ等を差し替え */
export function __setMediaDbForTest(db) {
  mediaDbOverride = db;
}

export function __resetMediaDbForTest() {
  mediaDbOverride = null;
}

function getMediaDb() {
  return mediaDbOverride || createNeonMediaDb();
}

function createNeonMediaDb() {
  return {
    async findById(id) {
      const sql = getDb();
      const rows = await sql`
        SELECT id, report_id, owner_student_id, owner_email,
               blob_pathname, thumb_pathname, content_type, byte_size,
               width, height, original_filename, caption, client_upload_key,
               delete_claim_token, status, created_at, updated_at
        FROM daily_report_media
        WHERE id = ${id}
        LIMIT 1
      `;
      return rows[0] || null;
    },

    /**
     * 未使用・（任意で）期限切れの行を status=deleting に原子的確保。
     * 確保ごとに新しい delete_claim_token を発行する。
     * unusedOnly: purge 用。attached / report_id ありは取れない。
     */
    async claimForDeletion({
      mediaId,
      unusedOnly = false,
      olderThanHours = null,
      reclaimMinutes = MEDIA_DELETE_RECLAIM_MINUTES,
    }) {
      const sql = getDb();
      const reclaim = Math.max(1, Number(reclaimMinutes) || MEDIA_DELETE_RECLAIM_MINUTES);
      const claimToken = newDeleteClaimToken();

      if (unusedOnly) {
        const hours = Math.max(0, Number(olderThanHours) || 0);
        const rows = await sql`
          UPDATE daily_report_media
          SET status = 'deleting',
              delete_claim_token = ${claimToken}::uuid,
              updated_at = NOW()
          WHERE id = ${mediaId}::uuid
            AND report_id IS NULL
            AND (
              (
                status IN ('pending', 'orphaned', 'delete_failed')
                AND updated_at < NOW() - (${String(hours)}::text || ' hours')::interval
              )
              OR (
                status = 'deleting'
                AND updated_at < NOW() - (${String(reclaim)}::text || ' minutes')::interval
              )
            )
          RETURNING id, report_id, owner_student_id, owner_email,
                    blob_pathname, thumb_pathname, content_type, byte_size,
                    width, height, original_filename, caption, client_upload_key,
                    delete_claim_token, status, created_at, updated_at
        `;
        return rows[0] || null;
      }

      // 明示削除: pending/orphaned/delete_failed/attached、およびスタックした deleting
      const rows = await sql`
        UPDATE daily_report_media
        SET status = 'deleting',
            delete_claim_token = ${claimToken}::uuid,
            updated_at = NOW()
        WHERE id = ${mediaId}::uuid
          AND (
            status IN ('pending', 'orphaned', 'delete_failed', 'attached')
            OR (
              status = 'deleting'
              AND updated_at < NOW() - (${String(reclaim)}::text || ' minutes')::interval
            )
          )
        RETURNING id, report_id, owner_student_id, owner_email,
                  blob_pathname, thumb_pathname, content_type, byte_size,
                  width, height, original_filename, caption, client_upload_key,
                  delete_claim_token, status, created_at, updated_at
      `;
      return rows[0] || null;
    },

    /** claim_token が一致する deleting 行だけ delete_failed へ（一致しなければ no-op） */
    async markDeleteFailed(id, claimToken) {
      if (!claimToken) return false;
      const sql = getDb();
      const rows = await sql`
        UPDATE daily_report_media
        SET status = 'delete_failed',
            delete_claim_token = NULL,
            updated_at = NOW()
        WHERE id = ${id}::uuid
          AND status = 'deleting'
          AND delete_claim_token = ${claimToken}::uuid
        RETURNING id
      `;
      return rows.length > 0;
    },

    /** claim_token が一致する deleting 行だけ物理削除 */
    async removeClaimed(id, claimToken) {
      if (!claimToken) return false;
      const sql = getDb();
      const rows = await sql`
        DELETE FROM daily_report_media
        WHERE id = ${id}::uuid
          AND status = 'deleting'
          AND delete_claim_token = ${claimToken}::uuid
        RETURNING id
      `;
      return rows.length > 0;
    },
  };
}

export async function isDailyReportMediaTableReady() {
  if (mediaTableReadyCache !== null) return mediaTableReadyCache;
  try {
    const sql = getDb();
    const rows = await sql`
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'daily_report_media'
      LIMIT 1
    `;
    mediaTableReadyCache = rows.length > 0;
  } catch {
    mediaTableReadyCache = false;
  }
  return mediaTableReadyCache;
}

export function resetDailyReportMediaTableReadyCache() {
  mediaTableReadyCache = null;
}

export function assertBlobConfigured() {
  const token = String(process.env.BLOB_READ_WRITE_TOKEN || '').trim();
  if (!token) {
    const err = new Error(
      '画像ストレージが未設定です。Vercel Blob を作成し BLOB_READ_WRITE_TOKEN を設定してください。',
    );
    err.status = 503;
    err.code = 'blob_not_configured';
    throw err;
  }
  return token;
}

/** Base64 方式だと上限近傍で Vercel ボディを超えることを示す（回帰用） */
export function estimateBase64JsonUploadBytes(imageBytes, thumbBytes = 0) {
  const b64 = (n) => Math.ceil(n / 3) * 4;
  // ざっくり JSON キー・カンマ等
  return b64(imageBytes) + b64(thumbBytes) + 256;
}

/** raw binary + ヘッダメタの推定（実送信に近い） */
export function estimateRawUploadBytes(imageBytes) {
  return imageBytes + 512;
}

export function uploadFitsVercelLimit(imageBytes, { mode = 'raw', thumbBytes = 0 } = {}) {
  const size = mode === 'base64'
    ? estimateBase64JsonUploadBytes(imageBytes, thumbBytes)
    : estimateRawUploadBytes(imageBytes);
  return size <= VERCEL_FUNCTION_BODY_LIMIT_BYTES;
}

/** マジックバイトで実形式を判定（拡張子は信用しない） */
export function detectImageContentType(buffer) {
  if (!buffer || buffer.length < 12) return null;
  const b = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46
    && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  ) {
    return 'image/webp';
  }
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) {
    const brand = String.fromCharCode(b[8], b[9], b[10], b[11]).toLowerCase();
    if (['heic', 'heif', 'mif1', 'msf1'].includes(brand) || brand.includes('he')) {
      return 'image/heic';
    }
  }
  return null;
}

export function validateUploadBuffer(buffer, claimedType) {
  if (!buffer || !buffer.length) {
    return { ok: false, error: 'ファイルが空です', status: 400 };
  }
  if (buffer.length > MEDIA_LIMITS.maxBytes) {
    return {
      ok: false,
      error: `画像は ${formatMiB(MEDIA_LIMITS.maxBytes)} 以下にしてください（Vercel リクエスト上限 ${formatMiB(VERCEL_FUNCTION_BODY_LIMIT_BYTES)} 内）`,
      status: 413,
    };
  }
  if (!uploadFitsVercelLimit(buffer.length, { mode: 'raw' })) {
    return {
      ok: false,
      error: `リクエストが Vercel の上限（${formatMiB(VERCEL_FUNCTION_BODY_LIMIT_BYTES)}）を超えます`,
      status: 413,
      code: 'payload_too_large',
    };
  }
  const detected = detectImageContentType(buffer);
  if (!detected) {
    return { ok: false, error: '対応形式は JPEG / PNG / WebP です', status: 415 };
  }
  if (detected === 'image/heic') {
    return { ok: false, error: HEIC_HINT, status: 415, code: 'heic_unsupported' };
  }
  if (!MEDIA_LIMITS.allowedContentTypes.includes(detected)) {
    return { ok: false, error: '対応形式は JPEG / PNG / WebP です', status: 415 };
  }
  if (claimedType && claimedType !== detected && claimedType !== 'image/jpg') {
    if (!(claimedType === 'image/jpg' && detected === 'image/jpeg')) {
      return { ok: false, error: '申告された形式と実ファイルが一致しません', status: 415 };
    }
  }
  return { ok: true, contentType: detected };
}

function formatMiB(bytes) {
  const n = bytes / (1024 * 1024);
  return `${Number.isInteger(n) ? n : n.toFixed(1)}MB`;
}

/**
 * sharp でデコード可能か検証し、向き反映・メタ除去・縮小・サムネ生成。
 * クライアント申告の width/height は使わない。
 */
export async function normalizeAndValidateImage(buffer, claimedType = null) {
  const validated = validateUploadBuffer(buffer, claimedType);
  if (!validated.ok) return validated;

  let meta;
  try {
    meta = await sharp(buffer, { failOn: 'error' }).metadata();
  } catch {
    return { ok: false, error: '画像としてデコードできませんでした', status: 415, code: 'undecodable' };
  }

  const format = String(meta.format || '').toLowerCase();
  const formatToCt = { jpeg: 'image/jpeg', jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
  const decodedType = formatToCt[format] || null;
  if (!decodedType || decodedType !== validated.contentType) {
    // sharp が heif 等を読める環境でも日報では拒否
    if (format === 'heif' || format === 'heic') {
      return { ok: false, error: HEIC_HINT, status: 415, code: 'heic_unsupported' };
    }
    return { ok: false, error: '対応形式は JPEG / PNG / WebP です', status: 415 };
  }

  // rotate() 前の寸法でも画素上限を見る（向き後も maxEdge で抑える）
  const w0 = meta.width || 0;
  const h0 = meta.height || 0;
  if (!w0 || !h0) {
    return { ok: false, error: '画像の寸法を取得できませんでした', status: 415 };
  }
  if (w0 * h0 > MEDIA_LIMITS.maxPixels * 4) {
    // 極端な超大画像は処理前に拒否（メモリ保護）。通常は縮小対象。
    return {
      ok: false,
      error: `画像の画素数が大きすぎます（最大およそ ${MEDIA_LIMITS.maxEdgePx}px 辺）`,
      status: 413,
      code: 'too_many_pixels',
    };
  }

  try {
    const outFormat = validated.contentType === 'image/png'
      ? 'png'
      : validated.contentType === 'image/webp'
        ? 'webp'
        : 'jpeg';

    let pipeline = sharp(buffer, { failOn: 'error' })
      .rotate() // EXIF Orientation 反映
      .resize({
        width: MEDIA_LIMITS.maxEdgePx,
        height: MEDIA_LIMITS.maxEdgePx,
        fit: 'inside',
        withoutEnlargement: true,
      });

    // メタデータ除去: sharp は toBuffer 時にデフォルトで大半を落とす。明示的に withMetadata しない。
    if (outFormat === 'jpeg') {
      pipeline = pipeline.jpeg({ quality: 85, mozjpeg: true });
    } else if (outFormat === 'png') {
      pipeline = pipeline.png({ compressionLevel: 8 });
    } else {
      pipeline = pipeline.webp({ quality: 82 });
    }

    const { data: outBuf, info } = await pipeline.toBuffer({ resolveWithObject: true });
    if (outBuf.length > MEDIA_LIMITS.maxBytes) {
      return {
        ok: false,
        error: `圧縮後も ${formatMiB(MEDIA_LIMITS.maxBytes)} を超えます`,
        status: 413,
      };
    }
    if (info.width * info.height > MEDIA_LIMITS.maxPixels) {
      return {
        ok: false,
        error: `画像寸法が上限（長辺 ${MEDIA_LIMITS.maxEdgePx}px）を超えています`,
        status: 413,
        code: 'dimensions_exceeded',
      };
    }

    const thumb = await sharp(outBuf)
      .resize({
        width: MEDIA_LIMITS.thumbEdgePx,
        height: MEDIA_LIMITS.thumbEdgePx,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: 72, mozjpeg: true })
      .toBuffer();

    if (thumb.length > MEDIA_LIMITS.maxThumbBytes) {
      // 再圧縮
      const thumb2 = await sharp(outBuf)
        .resize({
          width: Math.min(MEDIA_LIMITS.thumbEdgePx, 320),
          height: Math.min(MEDIA_LIMITS.thumbEdgePx, 320),
          fit: 'inside',
          withoutEnlargement: true,
        })
        .jpeg({ quality: 60 })
        .toBuffer();
      return {
        ok: true,
        contentType: validated.contentType === 'image/png' ? 'image/png'
          : validated.contentType === 'image/webp' ? 'image/webp' : 'image/jpeg',
        buffer: outBuf,
        thumbBuffer: thumb2,
        width: info.width,
        height: info.height,
      };
    }

    return {
      ok: true,
      contentType: outFormat === 'png' ? 'image/png' : outFormat === 'webp' ? 'image/webp' : 'image/jpeg',
      buffer: outBuf,
      thumbBuffer: thumb,
      width: info.width,
      height: info.height,
    };
  } catch (e) {
    return {
      ok: false,
      error: '画像の正規化に失敗しました',
      status: 415,
      code: 'normalize_failed',
      detail: e?.message,
    };
  }
}

function mapMediaRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    report_id: row.report_id,
    owner_student_id: row.owner_student_id,
    content_type: row.content_type,
    byte_size: row.byte_size,
    width: row.width,
    height: row.height,
    original_filename: row.original_filename,
    caption: row.caption,
    status: row.status,
    has_thumb: !!row.thumb_pathname,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function findMediaById(id) {
  return getMediaDb().findById(id);
}

export async function canViewMedia(user, mediaRow) {
  if (!user || !mediaRow) return false;
  if (
    mediaRow.status === 'pending'
    || mediaRow.status === 'orphaned'
    || mediaRow.status === 'delete_failed'
    || mediaRow.status === 'deleting'
  ) {
    if (user.role === 'admin') return true;
    return mediaOwnedByUser(user, mediaRow);
  }
  if (!mediaRow.report_id) return mediaOwnedByUser(user, mediaRow);
  const report = await findDailyReportById(mediaRow.report_id);
  if (!report) return false;
  return canViewReport(user, report);
}

export function mediaOwnedByUser(user, mediaRow) {
  if (!user || !mediaRow) return false;
  if (user.role === 'admin') return true;
  if (user.studentId && mediaRow.owner_student_id
    && String(user.studentId) === String(mediaRow.owner_student_id)) {
    return true;
  }
  const email = String(user.email || '').toLowerCase();
  const owner = String(mediaRow.owner_email || '').toLowerCase();
  return !!email && email === owner;
}

export function canDeleteMedia(user, mediaRow) {
  if (!user || !mediaRow) return false;
  if (user.role === 'admin') return true;
  return mediaOwnedByUser(user, mediaRow);
}

function ownerFields(user) {
  const studentId = user.studentId || null;
  if (!studentId) {
    const err = new Error('画像アップロードには学生プロフィール（student_id）が必要です');
    err.status = 403;
    err.code = 'student_required';
    throw err;
  }
  return {
    ownerStudentId: studentId,
    ownerEmail: String(user.email || '').trim().toLowerCase(),
  };
}

function buildPathname(ownerStudentId, mediaId, kind, ext) {
  const safeExt = ext === 'png' ? 'png' : ext === 'webp' ? 'webp' : 'jpg';
  const suffix = kind === 'thumb' ? 'thumb' : 'full';
  return `daily-reports/${ownerStudentId}/${mediaId}-${suffix}.${safeExt}`;
}

function extForContentType(ct) {
  if (ct === 'image/png') return 'png';
  if (ct === 'image/webp') return 'webp';
  return 'jpg';
}

async function safeDelBlob(pathnameOrUrl) {
  if (!pathnameOrUrl) return { ok: true };
  try {
    await blobOps.del(pathnameOrUrl, { token: process.env.BLOB_READ_WRITE_TOKEN });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e };
  }
}

/**
 * サーバー受信バッファを正規化して private Blob に保存し、メタ行を作成する。
 * client_upload_key が既存なら既存行を返す（再試行の重複防止）。
 */
export async function uploadDailyReportMedia(user, {
  buffer,
  contentType: claimedType = null,
  originalFilename = null,
  caption = null,
  clientUploadKey = null,
  // 後方互換: クライアント申告寸法は無視（検証は sharp）
  width: _ignoredWidth = null,
  height: _ignoredHeight = null,
  thumbBuffer: _ignoredThumb = null,
}) {
  const ready = await isDailyReportMediaTableReady();
  if (!ready) {
    const err = new Error(
      'daily_report_media テーブルが未適用です。db/migrations/2026-11-daily-report-media.sql を Neon に適用してください。',
    );
    err.status = 503;
    err.code = 'media_table_missing';
    throw err;
  }

  assertBlobConfigured();
  const { ownerStudentId, ownerEmail } = ownerFields(user);

  const key = clientUploadKey ? String(clientUploadKey).trim().slice(0, 128) : null;
  if (key) {
    const sql = getDb();
    const existing = await sql`
      SELECT id, report_id, owner_student_id, owner_email,
             blob_pathname, thumb_pathname, content_type, byte_size,
             width, height, original_filename, caption, client_upload_key,
             status, created_at, updated_at
      FROM daily_report_media
      WHERE owner_student_id = ${ownerStudentId}::uuid
        AND client_upload_key = ${key}
      LIMIT 1
    `;
    if (existing[0]) return mapMediaRow(existing[0]);
  }

  const normalized = await normalizeAndValidateImage(buffer, claimedType);
  if (!normalized.ok) {
    const err = new Error(normalized.error);
    err.status = normalized.status || 400;
    if (normalized.code) err.code = normalized.code;
    throw err;
  }

  const mediaId = crypto.randomUUID();
  const ext = extForContentType(normalized.contentType);
  const pathname = buildPathname(ownerStudentId, mediaId, 'full', ext);
  const thumbPath = buildPathname(ownerStudentId, mediaId, 'thumb', 'jpg');

  const putPaths = [];
  let blob;
  try {
    blob = await blobOps.put(pathname, normalized.buffer, {
      access: 'private',
      contentType: normalized.contentType,
      addRandomSuffix: false,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });
    putPaths.push(blob.url || pathname);

    await blobOps.put(thumbPath, normalized.thumbBuffer, {
      access: 'private',
      contentType: 'image/jpeg',
      addRandomSuffix: false,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });
    putPaths.push(thumbPath);
  } catch (e) {
    for (const p of putPaths) {
      await safeDelBlob(p);
    }
    throw e;
  }

  try {
    const sql = getDb();
    const rows = await sql`
      INSERT INTO daily_report_media (
        id, report_id, owner_student_id, owner_email,
        blob_pathname, thumb_pathname, content_type, byte_size,
        width, height, original_filename, caption, client_upload_key, status
      ) VALUES (
        ${mediaId}::uuid,
        NULL,
        ${ownerStudentId}::uuid,
        ${ownerEmail},
        ${blob.pathname || pathname},
        ${thumbPath},
        ${normalized.contentType},
        ${normalized.buffer.length},
        ${normalized.width},
        ${normalized.height},
        ${originalFilename ? String(originalFilename).slice(0, 200) : null},
        ${caption ? String(caption).slice(0, 500) : null},
        ${key},
        'pending'
      )
      RETURNING id, report_id, owner_student_id, owner_email,
                blob_pathname, thumb_pathname, content_type, byte_size,
                width, height, original_filename, caption, client_upload_key,
                status, created_at, updated_at
    `;
    return mapMediaRow(rows[0]);
  } catch (e) {
    for (const p of putPaths) {
      await safeDelBlob(p);
    }
    throw e;
  }
}

/** バイナリ取得（認可後）。variant=thumb|full */
export async function readMediaBlob(user, mediaId, variant = 'full') {
  const row = await findMediaById(mediaId);
  if (!row) {
    const err = new Error('Media not found');
    err.status = 404;
    throw err;
  }
  if (!(await canViewMedia(user, row))) {
    const err = new Error('Forbidden');
    err.status = 403;
    err.code = 'forbidden';
    throw err;
  }

  assertBlobConfigured();
  const pathname = variant === 'thumb' && row.thumb_pathname
    ? row.thumb_pathname
    : row.blob_pathname;

  const result = await blobOps.get(pathname, {
    access: 'private',
    token: process.env.BLOB_READ_WRITE_TOKEN,
  });
  if (!result || result.statusCode !== 200 || !result.stream) {
    const err = new Error('画像の取得に失敗しました');
    err.status = 502;
    throw err;
  }
  return {
    stream: result.stream,
    contentType: variant === 'thumb' ? 'image/jpeg' : row.content_type,
    media: mapMediaRow(row),
  };
}

/**
 * 確保済み（status=deleting + delete_claim_token）行の Blob を消し、成功なら行削除。
 * DB 更新は claim_token 一致時のみ。古い処理は新しい確保を変更できない。
 * Blob 失敗時は delete_failed に戻し、pathname 等を残して再試行可能にする。
 */
export async function finalizeClaimedMediaDeletion(claimed) {
  if (!claimed || claimed.status !== 'deleting') {
    const err = new Error('削除確保されていない画像です');
    err.status = 409;
    err.code = 'not_claimed';
    throw err;
  }
  const claimToken = claimed.delete_claim_token;
  if (!claimToken) {
    const err = new Error('削除確保トークンがありません');
    err.status = 409;
    err.code = 'not_claimed';
    throw err;
  }

  assertBlobConfigured();
  const db = getMediaDb();

  const fullDel = await safeDelBlob(claimed.blob_pathname);
  const thumbDel = claimed.thumb_pathname
    ? await safeDelBlob(claimed.thumb_pathname)
    : { ok: true };

  if (!fullDel.ok || !thumbDel.ok) {
    const marked = await db.markDeleteFailed(claimed.id, claimToken);
    if (!marked) {
      // 再確保済み — 古い処理は何も書き換えない
      return { ok: false, skipped: true, reason: 'claim_superseded', id: claimed.id };
    }
    const err = new Error('ストレージ上の削除に失敗しました。時間をおいて再試行してください');
    err.status = 502;
    err.code = 'blob_delete_failed';
    err.retryable = true;
    throw err;
  }

  const removed = await db.removeClaimed(claimed.id, claimToken);
  if (!removed) {
    // 新しい確保が先 — 古い処理は delete_failed にもしない
    return { ok: false, skipped: true, reason: 'claim_superseded', id: claimed.id };
  }
  return { ok: true, id: claimed.id };
}

/**
 * 原子的に deleting へ確保してから Blob 削除。
 * unusedOnly+olderThanHours: purge 用（添付確定と競合したら claim が null → Blob を触らない）。
 */
export async function claimAndDeleteMedia(mediaId, {
  unusedOnly = false,
  olderThanHours = null,
  reclaimMinutes = MEDIA_DELETE_RECLAIM_MINUTES,
} = {}) {
  const db = getMediaDb();
  const claimed = await db.claimForDeletion({
    mediaId,
    unusedOnly,
    olderThanHours,
    reclaimMinutes,
  });
  if (!claimed) {
    return { ok: false, skipped: true, reason: 'claim_failed', id: mediaId };
  }
  const finalized = await finalizeClaimedMediaDeletion(claimed);
  if (finalized?.skipped) {
    return { ok: false, skipped: true, reason: finalized.reason, id: mediaId };
  }
  return { ok: true, id: mediaId };
}

/**
 * ユーザー操作による削除。認可後に原子的確保 → Blob 削除。
 * attached も所有者/admin は削除可（日報 JSON 側は呼び出し元で整える想定）。
 */
export async function deleteMedia(user, mediaId) {
  const row = await findMediaById(mediaId);
  if (!row) {
    const err = new Error('Media not found');
    err.status = 404;
    throw err;
  }
  if (!canDeleteMedia(user, row)) {
    const err = new Error('Forbidden');
    err.status = 403;
    throw err;
  }
  if (row.report_id && user.role !== 'admin') {
    const report = await findDailyReportById(row.report_id);
    if (report && !reportOwnedByUser(user, report) && !mediaOwnedByUser(user, row)) {
      const err = new Error('Forbidden');
      err.status = 403;
      throw err;
    }
  }

  const result = await claimAndDeleteMedia(mediaId, { unusedOnly: false });
  if (!result.ok) {
    const err = new Error('画像は削除できない状態です（添付確定との競合、または処理中）');
    err.status = 409;
    err.code = 'media_delete_conflict';
    throw err;
  }
  return { ok: true };
}

function collectMediaIdsFromAttachments(attachments) {
  const mediaIds = [];
  for (const a of attachments || []) {
    if (a && a.kind === 'media' && a.media_id) mediaIds.push(String(a.media_id));
  }
  return mediaIds;
}

export async function assertMediaAttachmentsOwned(user, attachments, { reportId = null } = {}) {
  const mediaIds = collectMediaIdsFromAttachments(attachments);
  if (!mediaIds.length) return;

  const ready = await isDailyReportMediaTableReady();
  if (!ready) {
    const err = new Error(
      'daily_report_media テーブルが未適用です。db/migrations/2026-11-daily-report-media.sql を Neon に適用してください。',
    );
    err.status = 503;
    err.code = 'media_table_missing';
    throw err;
  }

  if (mediaIds.length > MEDIA_LIMITS.maxFilesPerReport) {
    const err = new Error(`画像は日報あたり最大 ${MEDIA_LIMITS.maxFilesPerReport} 枚です`);
    err.status = 400;
    throw err;
  }

  const uniqueIds = [...new Set(mediaIds)];
  for (const mid of uniqueIds) {
    const row = await findMediaById(mid);
    if (!row) {
      const err = new Error(`画像が見つかりません: ${mid}`);
      err.status = 400;
      err.code = 'media_not_found';
      throw err;
    }
    if (!mediaOwnedByUser(user, row) && user.role !== 'admin') {
      const err = new Error('他人の画像は添付できません');
      err.status = 403;
      err.code = 'media_ownership';
      throw err;
    }
    if (!ATTACHABLE_MEDIA_STATUSES.includes(row.status)) {
      const err = new Error('削除処理中または削除失敗状態の画像は添付できません');
      err.status = 409;
      err.code = 'media_not_attachable';
      throw err;
    }
    if (row.report_id && reportId && String(row.report_id) !== String(reportId)) {
      const err = new Error('別の日報に紐付いた画像は添付できません');
      err.status = 409;
      err.code = 'media_already_attached';
      throw err;
    }
    if (row.report_id && !reportId) {
      const err = new Error('別の日報に紐付いた画像は添付できません');
      err.status = 409;
      err.code = 'media_already_attached';
      throw err;
    }
  }
}

/**
 * interactive transaction 内で条件付き紐付け。
 * 同時に2つの日報が同じ media を取ろうとすると、後勝ち側が rowCount=0 で 409。
 */
export async function syncMediaAttachmentsInTx(client, user, reportId, attachments) {
  const uniqueIds = [...new Set(collectMediaIdsFromAttachments(attachments))];
  if (uniqueIds.length > MEDIA_LIMITS.maxFilesPerReport) {
    const err = new Error(`画像は日報あたり最大 ${MEDIA_LIMITS.maxFilesPerReport} 枚です`);
    err.status = 400;
    throw err;
  }

  const isAdmin = user.role === 'admin';
  const ownerStudentId = user.studentId || null;

  for (const mid of uniqueIds) {
    const r = await client.query(
      `UPDATE daily_report_media
       SET report_id = $1::uuid, status = 'attached', updated_at = NOW()
       WHERE id = $2::uuid
         AND status IN ('pending', 'orphaned', 'attached')
         AND (report_id IS NULL OR report_id = $1::uuid)
         AND (
           $4::boolean = true
           OR owner_student_id = $3::uuid
         )
       RETURNING id`,
      [reportId, mid, ownerStudentId, isAdmin],
    );
    if (r.rowCount === 0) {
      const err = new Error('別の日報に紐付いた画像は添付できません（削除処理中・競合または権限）');
      err.status = 409;
      err.code = 'media_already_attached';
      throw err;
    }
  }

  if (uniqueIds.length === 0) {
    await client.query(
      `UPDATE daily_report_media
       SET status = 'orphaned', report_id = NULL, updated_at = NOW()
       WHERE report_id = $1::uuid AND status = 'attached'`,
      [reportId],
    );
  } else {
    await client.query(
      `UPDATE daily_report_media
       SET status = 'orphaned', report_id = NULL, updated_at = NOW()
       WHERE report_id = $1::uuid AND status = 'attached'
         AND NOT (id = ANY($2::uuid[]))`,
      [reportId, uniqueIds],
    );
  }
}

/** 非 TX 経路（後方互換）。内部で interactive TX を開く */
export async function syncMediaAttachmentsForReport(user, reportId, attachments) {
  const ready = await isDailyReportMediaTableReady();
  if (!ready) return;

  const report = await findDailyReportById(reportId);
  if (!report) return;
  if (!canEditReportLike(user, report)) {
    const err = new Error('Forbidden');
    err.status = 403;
    throw err;
  }

  await assertMediaAttachmentsOwned(user, attachments, { reportId });

  const { withInteractiveTransaction } = await import('./db-tx.js');
  await withInteractiveTransaction(async (client) => {
    await syncMediaAttachmentsInTx(client, user, reportId, attachments);
  });
}

function canEditReportLike(user, report) {
  if (!user || !report) return false;
  if (user.role === 'admin') return true;
  return reportOwnedByUser(user, report);
}

/**
 * 一覧用の目安。実際の削除可否は claimForDeletion の原子的 UPDATE が決める。
 */
export function isMediaEligibleForPurge(row, {
  olderThanHours = 24,
  now = Date.now(),
  reclaimMinutes = MEDIA_DELETE_RECLAIM_MINUTES,
} = {}) {
  if (!row) return false;
  if (row.report_id) return false;
  if (row.status === 'attached') return false;
  const updated = new Date(row.updated_at || row.created_at).getTime();
  if (Number.isNaN(updated)) return false;
  if (row.status === 'deleting') {
    return updated < now - reclaimMinutes * 60 * 1000;
  }
  if (!['pending', 'orphaned', 'delete_failed'].includes(row.status)) return false;
  return updated < now - olderThanHours * 3600 * 1000;
}

export async function listPurgeCandidatesForOwner(user, { olderThanHours = 24 } = {}) {
  const { ownerStudentId } = ownerFields(user);
  const sql = getDb();
  const reclaim = MEDIA_DELETE_RECLAIM_MINUTES;
  const rows = await sql`
    SELECT id, report_id, owner_student_id, owner_email,
           blob_pathname, thumb_pathname, content_type, byte_size,
           width, height, original_filename, caption, client_upload_key,
           status, created_at, updated_at
    FROM daily_report_media
    WHERE owner_student_id = ${ownerStudentId}::uuid
      AND report_id IS NULL
      AND (
        (
          status IN ('pending', 'orphaned', 'delete_failed')
          AND updated_at < NOW() - (${olderThanHours}::text || ' hours')::interval
        )
        OR (
          status = 'deleting'
          AND updated_at < NOW() - (${String(reclaim)}::text || ' minutes')::interval
        )
      )
    ORDER BY updated_at ASC
    LIMIT 50
  `;
  return rows.filter((r) => isMediaEligibleForPurge(r, { olderThanHours }));
}

/**
 * 期限切れ未使用の掃除。候補 SELECT 後でも claim が原子的に勝敗を決める。
 * 添付が先に成功していれば claim 失敗 → Blob は削除しない。
 */
export async function purgeExpiredUnusedMedia(user, {
  olderThanHours = 24,
  limit = 20,
  reclaimMinutes = MEDIA_DELETE_RECLAIM_MINUTES,
  /** テスト用: Neon list を使わず指定 ID を候補にする */
  candidateIds = null,
} = {}) {
  let candidates;
  if (Array.isArray(candidateIds)) {
    candidates = [];
    for (const id of candidateIds.slice(0, limit)) {
      const row = await findMediaById(id);
      if (row) candidates.push(row);
    }
  } else {
    candidates = user.role === 'admin' && !user.studentId
      ? await listPurgeCandidatesAdmin({ olderThanHours, limit })
      : (await listPurgeCandidatesForOwner(user, { olderThanHours })).slice(0, limit);
  }

  const results = [];
  for (const row of candidates) {
    // 認可: 所有者または admin
    if (user.role !== 'admin' && !mediaOwnedByUser(user, row)) {
      results.push({ id: row.id, ok: false, skipped: true, reason: 'forbidden' });
      continue;
    }
    try {
      const result = await claimAndDeleteMedia(row.id, {
        unusedOnly: true,
        olderThanHours,
        reclaimMinutes,
      });
      if (!result.ok) {
        results.push({
          id: row.id,
          ok: false,
          skipped: true,
          reason: result.reason || 'claim_failed',
        });
        continue;
      }
      results.push({ id: row.id, ok: true });
    } catch (e) {
      results.push({
        id: row.id,
        ok: false,
        error: e.message,
        code: e.code,
        retryable: !!e.retryable,
      });
    }
  }
  return { purged: results.filter((r) => r.ok).length, results };
}

async function listPurgeCandidatesAdmin({ olderThanHours = 24, limit = 20 } = {}) {
  const sql = getDb();
  const reclaim = MEDIA_DELETE_RECLAIM_MINUTES;
  const rows = await sql`
    SELECT id, report_id, owner_student_id, owner_email,
           blob_pathname, thumb_pathname, content_type, byte_size,
           width, height, original_filename, caption, client_upload_key,
           status, created_at, updated_at
    FROM daily_report_media
    WHERE report_id IS NULL
      AND (
        (
          status IN ('pending', 'orphaned', 'delete_failed')
          AND updated_at < NOW() - (${olderThanHours}::text || ' hours')::interval
        )
        OR (
          status = 'deleting'
          AND updated_at < NOW() - (${String(reclaim)}::text || ' minutes')::interval
        )
      )
    ORDER BY updated_at ASC
    LIMIT ${limit}
  `;
  return rows;
}

export async function listOrphanMediaForOwner(user, { olderThanHours = 24 } = {}) {
  return listPurgeCandidatesForOwner(user, { olderThanHours });
}

/**
 * テスト用: インメモリ MediaDb。claim / attach の競合を同一ストアで再現する。
 */
export function createMemoryMediaDb() {
  /** @type {Map<string, object>} */
  const rows = new Map();

  return {
    seed(row) {
      rows.set(String(row.id), { ...row });
    },
    get(id) {
      const r = rows.get(String(id));
      return r ? { ...r } : null;
    },
    snapshot() {
      return [...rows.values()].map((r) => ({ ...r }));
    },
    async findById(id) {
      return this.get(id);
    },
    async claimForDeletion({
      mediaId,
      unusedOnly = false,
      olderThanHours = null,
      reclaimMinutes = MEDIA_DELETE_RECLAIM_MINUTES,
      now = Date.now(),
    }) {
      const row = rows.get(String(mediaId));
      if (!row) return null;
      const updated = new Date(row.updated_at || row.created_at).getTime();
      const reclaimMs = Math.max(1, Number(reclaimMinutes) || MEDIA_DELETE_RECLAIM_MINUTES) * 60 * 1000;
      const ageMs = Math.max(0, Number(olderThanHours) || 0) * 3600 * 1000;

      let ok = false;
      if (row.status === 'deleting') {
        if (updated < now - reclaimMs) {
          if (!unusedOnly || row.report_id == null) ok = true;
        }
      } else if (unusedOnly) {
        if (row.report_id != null) return null;
        if (!['pending', 'orphaned', 'delete_failed'].includes(row.status)) return null;
        if (updated >= now - ageMs) return null;
        ok = true;
      } else if (['pending', 'orphaned', 'delete_failed', 'attached'].includes(row.status)) {
        ok = true;
      }
      if (!ok) return null;
      row.status = 'deleting';
      row.delete_claim_token = newDeleteClaimToken();
      row.updated_at = new Date(now).toISOString();
      return { ...row };
    },
    /** syncMediaAttachmentsInTx 相当の条件付き添付（メモリ） */
    async tryAttach(mediaId, reportId, { ownerStudentId = null, isAdmin = false } = {}) {
      const row = rows.get(String(mediaId));
      if (!row) return false;
      if (!ATTACHABLE_MEDIA_STATUSES.includes(row.status)) return false;
      if (row.report_id && String(row.report_id) !== String(reportId)) return false;
      if (!isAdmin && ownerStudentId && String(row.owner_student_id) !== String(ownerStudentId)) {
        return false;
      }
      row.report_id = reportId;
      row.status = 'attached';
      row.delete_claim_token = null;
      row.updated_at = new Date().toISOString();
      return true;
    },
    async markDeleteFailed(id, claimToken) {
      const row = rows.get(String(id));
      if (!row) return false;
      if (row.status !== 'deleting') return false;
      if (!claimToken || String(row.delete_claim_token) !== String(claimToken)) return false;
      row.status = 'delete_failed';
      row.delete_claim_token = null;
      row.updated_at = new Date().toISOString();
      return true;
    },
    async removeClaimed(id, claimToken) {
      const row = rows.get(String(id));
      if (!row || row.status !== 'deleting') return false;
      if (!claimToken || String(row.delete_claim_token) !== String(claimToken)) return false;
      rows.delete(String(id));
      return true;
    },
  };
}
