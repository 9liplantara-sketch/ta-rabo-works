/** GAS 研究会日程 JSON の取得・正規化（seminar-schedule API / sessions sync 共通） */

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

/** @throws {Error & { status?: number }} */
export async function fetchSeminarScheduleFromGas() {
  const gasUrl = (process.env.SEMINAR_SCHEDULE_GAS_URL || '').trim();
  if (!gasUrl) {
    const err = new Error('SEMINAR_SCHEDULE_GAS_URL が未設定です');
    err.status = 503;
    throw err;
  }

  const gasRes = await fetch(gasUrl, {
    headers: { Accept: 'application/json' },
    redirect: 'follow',
  });

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
