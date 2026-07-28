/**
 * 研究会日程 API ＋ LINE Webhook（1関数に統合 — Hobby 12関数上限対策）
 *
 * GET  /api/seminar-schedule     … スプレッドシート日程 JSON
 * GET  /api/line-webhook         … LINE 検証用 OK（rewrite 経由）
 * POST /api/line-webhook         … LINE Webhook（groupId 保存）
 *
 * 環境変数: SEMINAR_SCHEDULE_GAS_URL
 */
import { withCors } from './lib/http.js';

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
  return req.method === 'POST';
}

function extractGroupId(raw) {
  if (!raw) return { groupId: '', eventType: '' };
  try {
    const data = JSON.parse(raw);
    const events = Array.isArray(data.events) ? data.events : [];
    for (const ev of events) {
      const groupId = ev && ev.source && ev.source.groupId;
      if (groupId) {
        return { groupId: String(groupId), eventType: String(ev.type || 'event') };
      }
    }
  } catch {
    // verify 時は空ボディなど
  }
  return { groupId: '', eventType: '' };
}

async function saveGroupIdToGas(gasUrl, groupId, eventType) {
  const url = new URL(gasUrl);
  url.searchParams.set('saveGroupId', groupId);
  if (eventType) url.searchParams.set('eventType', eventType);
  const res = await fetch(url.toString(), {
    method: 'GET',
    redirect: 'follow',
    headers: { Accept: 'application/json' },
  });
  const text = await res.text().catch(() => '');
  if (!res.ok) {
    console.error('GAS saveGroupId failed', res.status, text.slice(0, 300));
    return;
  }
  console.log('GAS saveGroupId ok', text.slice(0, 200));
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
  const { groupId, eventType } = extractGroupId(raw);
  const gasUrl = (process.env.SEMINAR_SCHEDULE_GAS_URL || '').trim();

  if (!groupId) {
    res.status(200).send('OK');
    return;
  }

  if (gasUrl) {
    try {
      await Promise.race([
        saveGroupIdToGas(gasUrl, groupId, eventType),
        new Promise((resolve) => setTimeout(resolve, 8000)),
      ]);
    } catch (err) {
      console.error('saveGroupIdToGas error', err);
    }
  } else {
    console.warn('groupId received but SEMINAR_SCHEDULE_GAS_URL is not set', groupId);
  }

  res.status(200).send('OK');
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

  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
  res.status(200).json({
    ok: true,
    source: data.source || 'google-sheets',
    updatedAt: data.updatedAt || null,
    schedule,
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
