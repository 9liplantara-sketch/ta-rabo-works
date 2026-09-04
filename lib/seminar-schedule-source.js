/** GAS 研究会日程 JSON の取得・正規化（/api/seminar-schedule 用） */

export function normalizeScheduleItem(item) {
  if (!item || !item.date) return null;
  return {
    session_key: item.session_key ? String(item.session_key).trim() || null : null,
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
  };
}

export function normalizeScheduleList(rawSchedule) {
  if (!Array.isArray(rawSchedule)) return [];
  return rawSchedule
    .map(normalizeScheduleItem)
    .filter(Boolean);
}

/** Vercel Hobby maxDuration=10s より短く切り、プラットフォーム 504（CORS なし）を避ける */
export const GAS_FETCH_TIMEOUT_MS = 7000;
export const GAS_RESPONSE_CACHE_TTL_MS = 60_000;

let cached = null;

/** @internal contract tests のみ */
export function __testResetSeminarScheduleCache() {
  cached = null;
}

function mapGasPayload(data) {
  return {
    source: data.source || 'google-sheets',
    updatedAt: data.updatedAt || null,
    schedule: normalizeScheduleList(data.schedule),
    scheduleError: data.scheduleError || null,
    groupIdReady: data.groupIdReady ?? null,
    reminderStatus: data.reminderStatus || null,
    scheduleDebug: data.scheduleDebug || null,
  };
}

/**
 * @throws {Error & { status?: number }}
 * @param {{ fetchImpl?: typeof fetch, now?: number, timeoutMs?: number }} [opts]
 */
export async function fetchSeminarScheduleFromGas({
  fetchImpl = globalThis.fetch,
  now = Date.now(),
  timeoutMs = GAS_FETCH_TIMEOUT_MS,
} = {}) {
  const gasUrl = (process.env.SEMINAR_SCHEDULE_GAS_URL || '').trim();
  if (!gasUrl) {
    const err = new Error('SEMINAR_SCHEDULE_GAS_URL が未設定です');
    err.status = 503;
    throw err;
  }

  if (cached && now - cached.at < GAS_RESPONSE_CACHE_TTL_MS) {
    return cached.data;
  }

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  let gasRes;
  try {
    gasRes = await fetchImpl(gasUrl, {
      headers: { Accept: 'application/json' },
      redirect: 'follow',
      signal: ac.signal,
    });
  } catch (err) {
    if (err?.name === 'AbortError') {
      const timeoutErr = new Error('スプレッドシート連携がタイムアウトしました');
      timeoutErr.status = 504;
      throw timeoutErr;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (!gasRes.ok) {
    const detail = await gasRes.text().catch(() => '');
    const err = new Error(`スプレッドシート連携の取得に失敗しました (${gasRes.status})`);
    err.status = 502;
    err.detail = detail.slice(0, 300);
    throw err;
  }

  const text = await gasRes.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    const err = new Error('GAS からの JSON 解析に失敗しました');
    err.status = 502;
    err.detail = text.slice(0, 300);
    throw err;
  }

  const mapped = mapGasPayload(data);
  cached = { at: now, data: mapped };
  return mapped;
}
