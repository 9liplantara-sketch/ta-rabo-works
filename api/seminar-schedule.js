/**
 * 研究会日程（Google Apps Script Webアプリ経由）
 * 環境変数: SEMINAR_SCHEDULE_GAS_URL
 */
import { withCors } from './lib/http.js';

export default withCors(async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

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
});
