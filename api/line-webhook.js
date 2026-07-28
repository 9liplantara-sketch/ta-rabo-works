/**
 * LINE Messaging API Webhook 受け口（高速応答）
 *
 * Apps Script 直指定だとリダイレクト／コールドスタートで
 * 「Webhookイベントオブジェクト送信時にタイムアウト」になりやすい。
 * ここは即 200 を返し、裏で GAS に groupId を渡す。
 *
 * 環境変数:
 *   SEMINAR_SCHEDULE_GAS_URL  Apps Script ウェブアプリの /exec URL
 *
 * LINE Developers の Webhook URL:
 *   https://ta-rabo-works.vercel.app/api/line-webhook
 */
import { waitUntil } from '@vercel/functions';

function readBody(req) {
  if (req.body == null) return '';
  if (typeof req.body === 'string') return req.body;
  try {
    return JSON.stringify(req.body);
  } catch {
    return '';
  }
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
    // verify 時は空ボディや非 JSON もある
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
  } else {
    console.log('GAS saveGroupId ok', text.slice(0, 200));
  }
}

export default async function handler(req, res) {
  // Verify / 疎通確認（即 200 でタイムアウト回避）
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

  // LINE には先に 200（GAS を待たない）
  res.status(200).send('OK');

  if (groupId && gasUrl) {
    waitUntil(
      saveGroupIdToGas(gasUrl, groupId, eventType).catch((err) => {
        console.error('saveGroupIdToGas error', err);
      })
    );
  } else if (groupId && !gasUrl) {
    console.warn('groupId received but SEMINAR_SCHEDULE_GAS_URL is not set', groupId);
  }
}
