/**
 * LINE Messaging API Webhook 受け口（高速応答）
 *
 * Apps Script 直指定だとタイムアウトしやすいため、ここはすぐ 200 を返す。
 * groupId があるときだけ GAS へ保存を試みる。
 *
 * 環境変数: SEMINAR_SCHEDULE_GAS_URL（Apps Script の /exec URL）
 * Webhook URL: https://ta-rabo-works.vercel.app/api/line-webhook
 */

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

export default async function handler(req, res) {
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

  // LINE 検証は groupId なしで即 200
  if (!groupId) {
    res.status(200).send('OK');
    return;
  }

  // groupId 取得時は保存を待ってから 200（数秒以内を目標）
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
