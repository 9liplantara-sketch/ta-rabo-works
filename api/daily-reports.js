import { requireSession, enrichUserFromDb } from '../lib/auth.js';
import { withCors, readJsonBody } from '../lib/http.js';
import { appendVary } from '../lib/cors.js';
import {
  canViewReport,
  createDailyReport,
  findDailyReportById,
  listDailyReports,
  mapReportRow,
  parseListParams,
  updateDailyReport,
} from '../lib/daily-reports.js';
import {
  deleteMedia,
  MEDIA_LIMITS,
  purgeExpiredUnusedMedia,
  readMediaBlob,
  SERVER_METADATA_POLICY,
  uploadDailyReportMedia,
} from '../lib/daily-report-media.js';

async function streamToBuffer(stream) {
  const reader = stream.getReader();
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

function decodeBase64Payload(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const comma = raw.indexOf(',');
  const b64 = comma >= 0 && raw.slice(0, comma).includes('base64')
    ? raw.slice(comma + 1)
    : raw;
  try {
    return Buffer.from(b64, 'base64');
  } catch {
    return null;
  }
}

/** Vercel Node: JSON 以外は Buffer / string で届く想定 */
function readRawBodyBuffer(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') {
    // 空 JSON を誤読しないよう Content-Type を優先
    return Buffer.from(req.body, 'latin1');
  }
  if (req.body instanceof ArrayBuffer) return Buffer.from(req.body);
  if (req.body?.type === 'Buffer' && Array.isArray(req.body.data)) {
    return Buffer.from(req.body.data);
  }
  if (req.body && typeof req.body === 'object' && !Array.isArray(req.body)
    && (req.body.image_base64 || req.body.imageBase64)) {
    return null; // JSON 経路へ
  }
  return null;
}

function headerValue(req, name) {
  const key = Object.keys(req.headers || {}).find((h) => h.toLowerCase() === name.toLowerCase());
  if (!key) return '';
  const v = req.headers[key];
  return Array.isArray(v) ? String(v[0] || '') : String(v || '');
}

function decodeHeaderField(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export default withCors(async (req, res) => {
  const session = await requireSession(req);
  const user = await enrichUserFromDb(session);
  const resource = String(req.query?.resource || '').trim().toLowerCase();
  const action = String(req.query?.action || '').trim().toLowerCase();

  // ── 画像メディア（Hobby 関数数上限のため同一エンドポイントに統合） ──
  if (resource === 'media') {
    const mediaId = String(req.query?.id || '').trim();
    const variant = String(req.query?.variant || 'full').trim().toLowerCase() === 'thumb'
      ? 'thumb'
      : 'full';

    if (req.method === 'GET') {
      if (!mediaId) {
        res.status(400).json({
          error: 'id は必須です',
          limits: MEDIA_LIMITS,
          metadata_policy: SERVER_METADATA_POLICY,
        });
        return;
      }
      const { stream, contentType } = await readMediaBlob(user, mediaId, variant);
      const buf = await streamToBuffer(stream);
      res.setHeader('Content-Type', contentType || 'application/octet-stream');
      // 認可付きバイナリ: 共有キャッシュ不可。再認可のためブラウザ長期キャッシュもしない。
      res.setHeader('Cache-Control', 'private, no-store');
      // applyCors が付けた Vary: Origin を残しつつ Authorization を追加
      appendVary(res, 'Authorization');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.status(200).send(buf);
      return;
    }

    if (req.method === 'POST' && action === 'purge') {
      const olderThanHours = Math.min(
        168,
        Math.max(1, Number(req.query?.older_than_hours || 24) || 24),
      );
      const result = await purgeExpiredUnusedMedia(user, { olderThanHours, limit: 20 });
      res.status(200).json(result);
      return;
    }

    if (req.method === 'POST') {
      const ct = headerValue(req, 'content-type').split(';')[0].trim().toLowerCase();
      let buffer = null;
      let claimedType = null;
      let originalFilename = null;
      let caption = null;
      let clientUploadKey = null;

      if (ct.startsWith('image/')) {
        buffer = readRawBodyBuffer(req);
        claimedType = ct === 'image/jpg' ? 'image/jpeg' : ct;
        originalFilename = decodeHeaderField(headerValue(req, 'x-filename'));
        caption = decodeHeaderField(headerValue(req, 'x-caption'));
        clientUploadKey = decodeHeaderField(headerValue(req, 'x-client-upload-key'));
      } else {
        // 後方互換 JSON（Base64）。上限近傍は拒否しやすいので raw 推奨。
        const body = readJsonBody(req);
        buffer = decodeBase64Payload(body.image_base64 || body.imageBase64);
        claimedType = body.content_type || body.contentType || null;
        originalFilename = body.filename || body.original_filename || null;
        caption = body.caption || null;
        clientUploadKey = body.client_upload_key || body.clientUploadKey || null;
      }

      if (!buffer || !buffer.length) {
        res.status(400).json({
          error: '画像ボディ（raw binary または image_base64）は必須です',
          limits: MEDIA_LIMITS,
        });
        return;
      }

      if (buffer.length > MEDIA_LIMITS.maxBytes) {
        res.status(413).json({
          error: `画像は ${(MEDIA_LIMITS.maxBytes / (1024 * 1024)).toFixed(1)}MB 以下にしてください`,
          limits: MEDIA_LIMITS,
          code: 'payload_too_large',
        });
        return;
      }

      const media = await uploadDailyReportMedia(user, {
        buffer,
        contentType: claimedType,
        originalFilename,
        caption,
        clientUploadKey,
      });
      res.status(201).json({
        media,
        limits: MEDIA_LIMITS,
        metadata_policy: SERVER_METADATA_POLICY,
      });
      return;
    }

    if (req.method === 'DELETE') {
      if (!mediaId) {
        res.status(400).json({ error: 'id は必須です' });
        return;
      }
      await deleteMedia(user, mediaId);
      res.status(200).json({ ok: true });
      return;
    }

    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  if (req.method === 'GET') {
    const reportId = String(req.query?.id || '').trim();

    if (reportId) {
      const row = await findDailyReportById(reportId);
      if (!row) {
        res.status(404).json({ error: 'Report not found' });
        return;
      }
      if (!canViewReport(user, row)) {
        res.status(403).json({ error: 'Forbidden', code: 'forbidden' });
        return;
      }
      res.status(200).json({ report: mapReportRow(row) });
      return;
    }

    const params = parseListParams(req.query);
    const result = await listDailyReports(user, params);
    res.status(200).json({
      reports: result.reports,
      view: params.view,
      limit: result.limit,
      offset: result.offset,
      has_more: result.has_more,
    });
    return;
  }

  if (req.method === 'POST') {
    const body = readJsonBody(req);
    const report = await createDailyReport(user, body);
    res.status(201).json({ report });
    return;
  }

  if (req.method === 'PATCH') {
    const body = readJsonBody(req);
    const reportId = String(req.query?.id || body.id || '').trim();
    if (!reportId) {
      const err = new Error('id は必須です');
      err.status = 400;
      throw err;
    }
    const report = await updateDailyReport(user, reportId, body);
    res.status(200).json({ report });
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
});
