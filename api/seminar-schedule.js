/**
 * 研究会日程 API ＋ LINE Webhook（1関数に統合 — Hobby 12関数上限対策）
 *
 * GET  /api/seminar-schedule     … スプレッドシート日程 JSON
 * GET  /api/line-webhook         … LINE 検証用 OK（rewrite 経由）
 * POST /api/line-webhook         … LINE Webhook（groupId 保存）
 *
 * 環境変数: SEMINAR_SCHEDULE_GAS_URL
 */
import { waitUntil } from '@vercel/functions';
import { withCors } from '../lib/http.js';

function readBody(req) {
  if (req.body == null) return '';
  if (typeof req.body === 'string') return req.body;
  try {
    return JSON.stringify(req.body);
  } catch {
    return '';
  }
}

function requestPath(req) {
  const raw = req.url || '';
  const path = raw.split('?')[0];
  if (path.startsWith('http')) {
    try {
      return new URL(raw).pathname;
    } catch {
      return path;
    }
  }
  return path;
}

function isLineWebhookRequest(req) {
  const path = requestPath(req);
  if (path.includes('line-webhook')) return true;
  if (req.method === 'POST' && req.headers['x-line-signature']) return true;
  // rewrite 後は path が seminar-schedule になる
  if (req.method === 'POST' && path.includes('seminar-schedule')) return true;
  return false;
}

function extractPushTarget(raw) {
  if (!raw) return { id: '', mode: '', eventType: '' };
  try {
    const data = JSON.parse(raw);
    const events = Array.isArray(data.events) ? data.events : [];
    for (const ev of events) {
      const source = (ev && ev.source) || {};
      if (source.groupId) {
        return { id: String(source.groupId), mode: 'group', eventType: String(ev.type || 'event') };
      }
      if (source.roomId) {
        return { id: String(source.roomId), mode: 'room', eventType: String(ev.type || 'event') };
      }
      if (source.userId && source.type === 'user') {
        return { id: String(source.userId), mode: 'user', eventType: String(ev.type || 'event') };
      }
    }
  } catch {
    // verify 時は空ボディなど
  }
  return { id: '', mode: '', eventType: '' };
}

async function forwardWebhookToGas(gasUrl, raw) {
  const res = await fetch(gasUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: raw,
    redirect: 'follow',
  });
  const text = await res.text().catch(() => '');
  if (!res.ok) {
    console.error('GAS webhook forward failed', res.status, text.slice(0, 300));
    return false;
  }
  console.log('GAS webhook forward ok', text.slice(0, 200));
  return true;
}

async function savePushTargetToGas(gasUrl, target) {
  const url = new URL(gasUrl);
  const isUser = String(target.id).indexOf('U') === 0;
  if (isUser) {
    url.searchParams.set('saveUserId', target.id);
  } else {
    url.searchParams.set('saveGroupId', target.id);
  }
  if (target.eventType) url.searchParams.set('eventType', target.eventType);
  const res = await fetch(url.toString(), {
    method: 'GET',
    redirect: 'follow',
    headers: { Accept: 'application/json' },
  });
  const text = await res.text().catch(() => '');
  if (!res.ok) {
    console.error('GAS savePushTarget failed', res.status, text.slice(0, 300));
    return false;
  }
  console.log('GAS savePushTarget ok', target.mode, target.id, text.slice(0, 200));
  return true;
}

async function processWebhookInBackground(gasUrl, raw, target) {
  if (target.id) {
    await savePushTargetToGas(gasUrl, target);
  }
  if (raw) {
    await forwardWebhookToGas(gasUrl, raw);
  }
}

async function handleLineWebhook(req, res) {
  if (req.method === 'GET' || req.method === 'HEAD') {
    res.status(200).send('OK');
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).send('Method Not Allowed');
    return;
  }

  const raw = readBody(req);
  const target = extractPushTarget(raw);
  const gasUrl = (process.env.SEMINAR_SCHEDULE_GAS_URL || '').trim();

  let eventTypes = [];
  try {
    const parsed = raw ? JSON.parse(raw) : {};
    eventTypes = (parsed.events || []).map((ev) => ev && ev.type).filter(Boolean);
  } catch (_) {}

  console.log('LINE webhook', {
    hasBody: !!raw,
    target: target.id || '(none)',
    targetMode: target.mode || '(none)',
    eventTypes,
    gasConfigured: !!gasUrl,
  });

  // LINE は約1秒以内の 200 が必要。GAS 待ちの前に必ず返す。
  res.status(200).send('OK');

  if (!gasUrl) {
    if (target.id) {
      console.warn('push target received but SEMINAR_SCHEDULE_GAS_URL is not set', target.id);
    }
    return;
  }

  waitUntil(
    processWebhookInBackground(gasUrl, raw, target).catch((err) => {
      console.error('background webhook processing failed', err);
    })
  );
}

async function handleScheduleGet(req, res) {
  const gasUrl = (process.env.SEMINAR_SCHEDULE_GAS_URL || '').trim();
  if (!gasUrl) {
    res.status(503).json({
      ok: false,
      error: 'SEMINAR_SCHEDULE_GAS_URL が未設定です',
      schedule: [],
    });
    return;
  }

  const gasRes = await fetch(gasUrl, {
    headers: { Accept: 'application/json' },
    redirect: 'follow',
  });

  if (!gasRes.ok) {
    const detail = await gasRes.text().catch(() => '');
    res.status(502).json({
      ok: false,
      error: `スプレッドシート連携の取得に失敗しました (${gasRes.status})`,
      detail: detail.slice(0, 300),
      schedule: [],
    });
    return;
  }

  const text = await gasRes.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    res.status(502).json({
      ok: false,
      error: 'GAS からの JSON 解析に失敗しました',
      detail: text.slice(0, 300),
      schedule: [],
    });
    return;
  }

  const schedule = Array.isArray(data.schedule)
    ? data.schedule
        .filter((item) => item && item.date)
        .map((item) => ({
          date: String(item.date),
          type: String(item.type || 'lecture'),
          content: String(item.content || ''),
          place: String(item.place || ''),
          submissions: String(item.submissions || ''),
          preparations: String(item.preparations || ''),
          note: String(item.note || ''),
          start: String(item.start || ''),
          end: String(item.end || ''),
          timeOverride: String(item.timeOverride || ''),
        }))
    : [];

  res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');
  res.status(200).json({
    ok: true,
    source: data.source || 'google-sheets',
    updatedAt: data.updatedAt || null,
    schedule,
    scheduleError: data.scheduleError || null,
    scheduleDebug: data.scheduleDebug || null,
  });
}

export default withCors(async (req, res) => {
  if (isLineWebhookRequest(req)) {
    await handleLineWebhook(req, res);
    return;
  }

  if (req.method === 'GET') {
    await handleScheduleGet(req, res);
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
});
