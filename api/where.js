/**
 * Where is TARA? — Adafruit IO `where` フィードの最新値（公開読み取り用）
 * 環境変数: AIO_USERNAME, AIO_KEY
 */
import { withCors } from './lib/http.js';

const STATUSES = {
  CAMPUS: { label: '通勤・構内', short: '構内', color: '#00ff00' },
  LAB: { label: '研究室', short: '研究室', color: '#0000ff' },
  ELSE: { label: 'その他', short: 'その他', color: '#000000' },
  HOME: { label: '自宅', short: '自宅', color: '#ff0000' },
};

export default withCors(async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const username = (process.env.AIO_USERNAME || '').trim();
  const key = (process.env.AIO_KEY || '').trim();
  if (!username || !key) {
    res.status(503).json({
      error: 'AIO_USERNAME / AIO_KEY が未設定です',
      value: null,
      statuses: STATUSES,
    });
    return;
  }

  const url = `https://io.adafruit.com/api/v2/${encodeURIComponent(username)}/feeds/where/data?limit=1`;
  const aioRes = await fetch(url, {
    headers: { 'X-AIO-Key': key },
  });

  if (!aioRes.ok) {
    const text = await aioRes.text().catch(() => '');
    res.status(502).json({
      error: `Adafruit IO 取得に失敗しました (${aioRes.status})`,
      detail: text.slice(0, 200),
      value: null,
      statuses: STATUSES,
    });
    return;
  }

  const data = await aioRes.json();
  const row = Array.isArray(data) ? data[0] : null;
  const raw = String(row?.value || '').trim().toUpperCase();
  const value = Object.prototype.hasOwnProperty.call(STATUSES, raw) ? raw : null;
  const meta = value ? STATUSES[value] : null;

  res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');
  res.status(200).json({
    value,
    label: meta?.label || null,
    color: meta?.color || null,
    updated_at: row?.created_at || null,
    statuses: STATUSES,
    app_url: 'https://where-sign-controller-fd3plxg8uywtu85xnk2zag.streamlit.app',
  });
});
