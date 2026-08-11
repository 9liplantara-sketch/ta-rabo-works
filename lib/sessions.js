import { getDb } from './db.js';

export const SESSION_SOURCE_SHEETS = 'sheets';
export const SESSION_TYPE_SEMINAR = 'seminar';
export const SESSION_STATUS_SCHEDULED = 'scheduled';

export function normOptionalText(value) {
  const s = (value ?? '').toString().trim();
  return s === '' ? null : s;
}

export function parseSessionDate(value) {
  const s = String(value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}

/** HH:mm → HH:mm（不正なら null）。架空時刻は補完しない */
export function parseTimeHm(value) {
  const s = String(value ?? '').trim();
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return `${String(hh).padStart(2, '0')}:${m[2]}`;
}

/** date + time を Asia/Tokyo の timestamptz 文字列へ（PostgreSQL が解釈） */
export function toTimestamptzJst(dateStr, timeStr) {
  const date = parseSessionDate(dateStr);
  const time = parseTimeHm(timeStr);
  if (!date || !time) return null;
  return `${date}T${time}:00+09:00`;
}

export function mapScheduleItemToSession(item) {
  const sessionKey = item.session_key ? String(item.session_key).trim() : '';
  const sessionDate = parseSessionDate(item.date);
  if (!sessionKey || !sessionDate) return null;

  const metadata = {};
  if (item.timeOverride) metadata.timeOverride = String(item.timeOverride);

  return {
    source: SESSION_SOURCE_SHEETS,
    source_key: sessionKey,
    type: SESSION_TYPE_SEMINAR,
    title: normOptionalText(item.content),
    session_no: null,
    session_date: sessionDate,
    starts_at: toTimestamptzJst(item.date, item.start),
    ends_at: toTimestamptzJst(item.date, item.end),
    status: SESSION_STATUS_SCHEDULED,
    place: normOptionalText(item.place),
    preparations: normOptionalText(item.preparations),
    submissions: normOptionalText(item.submissions),
    note: normOptionalText(item.note),
    event_subtype: normOptionalText(item.type),
    metadata,
  };
}

/**
 * 同期前バリデーション。
 * duplicate があれば ok:false。session_key 欠損等は skipped に積む。
 */
export function validateScheduleItems(scheduleItems) {
  const received = Array.isArray(scheduleItems) ? scheduleItems.length : 0;
  const skipped = [];
  const toSync = [];
  const keyCounts = new Map();

  for (const raw of scheduleItems || []) {
    const item = raw;
    const date = item?.date ? String(item.date) : null;
    const sessionKey = item?.session_key ? String(item.session_key).trim() : '';

    if (!sessionKey) {
      skipped.push({
        reason: 'missing_session_key',
        date: date || null,
      });
      continue;
    }

    if (!parseSessionDate(item.date)) {
      skipped.push({
        reason: 'missing_or_invalid_date',
        session_key: sessionKey,
        date: date || null,
      });
      continue;
    }

    keyCounts.set(sessionKey, (keyCounts.get(sessionKey) || 0) + 1);
    toSync.push(item);
  }

  const duplicateKeys = [...keyCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([key]) => key);

  if (duplicateKeys.length) {
    return {
      ok: false,
      error: 'duplicate_session_key',
      keys: duplicateKeys.sort(),
      received,
      skipped,
    };
  }

  return {
    ok: true,
    received,
    skipped,
    toSync,
  };
}

export function mapSessionRow(row) {
  if (!row) return null;
  let metadata = row.metadata;
  if (typeof metadata === 'string') {
    try { metadata = JSON.parse(metadata); } catch { metadata = {}; }
  }
  if (!metadata || typeof metadata !== 'object') metadata = {};

  return {
    id: row.id,
    type: row.type,
    title: row.title,
    session_no: row.session_no,
    session_date: row.session_date,
    starts_at: row.starts_at,
    ends_at: row.ends_at,
    status: row.status,
    place: row.place,
    preparations: row.preparations,
    submissions: row.submissions,
    note: row.note,
    event_subtype: row.event_subtype,
    source: row.source,
    source_key: row.source_key,
    metadata,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function upsertSessionFromSchedule(mapped) {
  const sql = getDb();
  const metadataJson = JSON.stringify(mapped.metadata || {});

  const rows = await sql`
    INSERT INTO sessions (
      type, title, session_no, session_date, starts_at, ends_at, status,
      source, source_key, place, preparations, submissions, note,
      event_subtype, metadata
    ) VALUES (
      ${mapped.type},
      ${mapped.title},
      ${mapped.session_no},
      ${mapped.session_date},
      ${mapped.starts_at},
      ${mapped.ends_at},
      ${mapped.status},
      ${mapped.source},
      ${mapped.source_key},
      ${mapped.place},
      ${mapped.preparations},
      ${mapped.submissions},
      ${mapped.note},
      ${mapped.event_subtype},
      ${metadataJson}::jsonb
    )
    ON CONFLICT (source, source_key) DO UPDATE SET
      type = EXCLUDED.type,
      title = EXCLUDED.title,
      session_no = EXCLUDED.session_no,
      session_date = EXCLUDED.session_date,
      starts_at = EXCLUDED.starts_at,
      ends_at = EXCLUDED.ends_at,
      status = EXCLUDED.status,
      place = EXCLUDED.place,
      preparations = EXCLUDED.preparations,
      submissions = EXCLUDED.submissions,
      note = EXCLUDED.note,
      event_subtype = EXCLUDED.event_subtype,
      metadata = EXCLUDED.metadata
    RETURNING id, type, title, session_no, session_date, starts_at, ends_at, status,
              source, source_key, place, preparations, submissions, note,
              event_subtype, metadata, created_at, updated_at
  `;

  return mapSessionRow(rows[0]);
}

export async function syncSessionsFromSchedule(scheduleItems) {
  const validation = validateScheduleItems(scheduleItems);
  if (!validation.ok) {
    const err = new Error(validation.error);
    err.status = 400;
    err.keys = validation.keys;
    err.received = validation.received;
    err.skipped = validation.skipped;
    throw err;
  }

  let synced = 0;
  for (const item of validation.toSync) {
    const mapped = mapScheduleItemToSession(item);
    if (!mapped) {
      validation.skipped.push({
        reason: 'mapping_failed',
        session_key: item.session_key,
        date: item.date,
      });
      continue;
    }
    await upsertSessionFromSchedule(mapped);
    synced += 1;
  }

  return {
    ok: true,
    source: SESSION_SOURCE_SHEETS,
    received: validation.received,
    synced,
    skipped: validation.skipped.length,
    skipped_items: validation.skipped,
  };
}

export function parseListSessionsParams(query = {}) {
  const dateRaw = String(query.date || '').trim();
  const date = dateRaw ? parseSessionDate(dateRaw) : null;
  if (dateRaw && !date) {
    const err = new Error('date は YYYY-MM-DD 形式で指定してください');
    err.status = 400;
    throw err;
  }

  const type = String(query.type || '').trim().toLowerCase() || null;
  if (type && !['seminar', 'lesson', 'meeting'].includes(type)) {
    const err = new Error('type は seminar / lesson / meeting のいずれか');
    err.status = 400;
    throw err;
  }

  const limit = Math.min(Math.max(Number(query.limit) || 100, 1), 200);
  const offset = Math.max(Number(query.offset) || 0, 0);

  return { date, type, limit, offset };
}

export async function listSessions(params) {
  const { date, type, limit, offset } = params;
  const sql = getDb();

  const rows = await sql`
    SELECT id, type, title, session_no, session_date, starts_at, ends_at, status,
           source, source_key, place, preparations, submissions, note,
           event_subtype, metadata, created_at, updated_at
    FROM sessions
    WHERE (${date}::date IS NULL OR session_date = ${date}::date)
      AND (${type}::text IS NULL OR type = ${type})
    ORDER BY session_date DESC, starts_at DESC NULLS LAST, source_key ASC
    LIMIT ${limit} OFFSET ${offset}
  `;

  return {
    sessions: rows.map(mapSessionRow),
    limit,
    offset,
  };
}

export async function getSessionById(id) {
  const sql = getDb();
  const rows = await sql`
    SELECT id, type, title, session_no, session_date, starts_at, ends_at, status,
           source, source_key, place, preparations, submissions, note,
           event_subtype, metadata, created_at, updated_at
    FROM sessions
    WHERE id = ${id}
    LIMIT 1
  `;
  return mapSessionRow(rows[0]) || null;
}

export async function countSessions() {
  const sql = getDb();
  const rows = await sql`SELECT COUNT(*)::int AS n FROM sessions`;
  return rows[0]?.n ?? 0;
}
