import { getDb } from './db.js';
import { findStudentById } from './db.js';
import { parseSessionKey, toIlikePattern, parseDateParam } from './daily-reports.js';
import { canViewKnowledgeRecord } from './knowledge-access.js';

let knowledgeRecordsTableReadyCache = null;

/** migration 未適用時は false（feed をクラッシュさせない） */
export async function isKnowledgeRecordsTableReady() {
  if (knowledgeRecordsTableReadyCache !== null) return knowledgeRecordsTableReadyCache;
  try {
    const sql = getDb();
    const rows = await sql`
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = 'knowledge_records'
      LIMIT 1
    `;
    knowledgeRecordsTableReadyCache = rows.length > 0;
  } catch {
    knowledgeRecordsTableReadyCache = false;
  }
  return knowledgeRecordsTableReadyCache;
}

export function resetKnowledgeRecordsTableReadyCache() {
  knowledgeRecordsTableReadyCache = null;
}

export const KNOWLEDGE_RECORD_TYPES = {
  meeting_minutes: '研究会・打ち合わせ議事録',
  transcript: '文字起こし',
  one_on_one: '個別面談記録',
  interview: 'インタビュー',
  admin_note: '管理者メモ',
  other: 'その他',
};

export const VALID_RECORD_TYPES = Object.keys(KNOWLEDGE_RECORD_TYPES);
export const VALID_KNOWLEDGE_VISIBILITY = ['lab', 'admin'];

export function parseKnowledgeVisibility(raw, { required = false } = {}) {
  if (raw === undefined || raw === null || raw === '') {
    if (required) return { ok: false, error: 'visibility は必須です' };
    return { ok: true, value: null };
  }
  const v = String(raw).toLowerCase();
  if (!VALID_KNOWLEDGE_VISIBILITY.includes(v)) {
    return { ok: false, error: `visibility は ${VALID_KNOWLEDGE_VISIBILITY.join(' / ')} のいずれか` };
  }
  return { ok: true, value: v };
}

export function parseRecordType(raw, { required = false } = {}) {
  if (raw === undefined || raw === null || raw === '') {
    if (required) return { ok: false, error: 'record_type は必須です' };
    return { ok: true, value: null };
  }
  const t = String(raw).trim();
  if (!VALID_RECORD_TYPES.includes(t)) {
    return { ok: false, error: `record_type が不正です` };
  }
  return { ok: true, value: t };
}

export function parseOccurredAt(raw) {
  if (!raw) return { ok: false, error: 'occurred_at は必須です' };
  const d = raw instanceof Date ? raw : new Date(String(raw));
  if (Number.isNaN(d.getTime())) return { ok: false, error: 'occurred_at が不正です' };
  return { ok: true, value: d.toISOString() };
}

export function parseKnowledgeListParams(query = {}) {
  const limit = Math.min(Math.max(Number(query.limit) || 30, 1), 100);
  const offset = Math.max(Number(query.offset) || 0, 0);
  const q = String(query.q || '').trim();
  const recordType = String(query.record_type || query.recordType || '').trim() || null;
  const studentId = String(query.student_id || query.studentId || '').trim() || null;
  const sessionKey = String(query.session_key || query.sessionKey || '').trim() || null;

  const fromRaw = parseDateParam(query.from);
  const toRaw = parseDateParam(query.to);
  if (fromRaw?.invalid || toRaw?.invalid) {
    const err = new Error('from / to は YYYY-MM-DD 形式で指定してください');
    err.status = 400;
    throw err;
  }

  return {
    limit,
    offset,
    q,
    recordType,
    studentId,
    sessionKey,
    from: fromRaw?.value ?? null,
    to: toRaw?.value ?? null,
  };
}

export function mapParticipantRow(row) {
  return {
    studentId: row.student_id || null,
    name: row.participant_name,
  };
}

export function mapKnowledgeRecordRow(row, participants = []) {
  if (!row) return null;
  return {
    id: row.id,
    record_type: row.record_type,
    title: row.title,
    occurred_at: row.occurred_at,
    session_key: row.session_key ?? null,
    body_text: row.body_text,
    summary_text: row.summary_text ?? null,
    decisions_text: row.decisions_text ?? null,
    next_actions_text: row.next_actions_text ?? null,
    visibility: row.visibility,
    created_by: row.created_by ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    participants,
  };
}

export async function loadParticipantsForRecords(sql, recordIds) {
  if (!recordIds.length) return new Map();
  const rows = await sql`
    SELECT record_id, student_id, participant_name
    FROM knowledge_record_participants
    WHERE record_id = ANY(${recordIds}::uuid[])
    ORDER BY participant_name ASC
  `;
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.record_id)) map.set(r.record_id, []);
    map.get(r.record_id).push(mapParticipantRow(r));
  }
  return map;
}

export async function findKnowledgeRecordById(id) {
  const sql = getDb();
  const rows = await sql`
    SELECT id, record_type, title, occurred_at, session_key,
           body_text, summary_text, decisions_text, next_actions_text,
           visibility, created_by, created_at, updated_at
    FROM knowledge_records
    WHERE id = ${id}
    LIMIT 1
  `;
  if (!rows[0]) return null;
  const parts = await loadParticipantsForRecords(sql, [rows[0].id]);
  return mapKnowledgeRecordRow(rows[0], parts.get(rows[0].id) || []);
}

export async function listKnowledgeRecordsForFeed(user, params) {
  const sql = getDb();
  const {
    limit, q, recordType, studentId, sessionKey, from, to,
  } = params;
  const qPattern = toIlikePattern(q);
  const adminOnly = user.role === 'admin';

  const rows = await sql`
    SELECT DISTINCT kr.id, kr.record_type, kr.title, kr.occurred_at, kr.session_key,
           kr.body_text, kr.summary_text, kr.decisions_text, kr.next_actions_text,
           kr.visibility, kr.created_by, kr.created_at, kr.updated_at
    FROM knowledge_records kr
    LEFT JOIN knowledge_record_participants krp ON krp.record_id = kr.id
    WHERE (${adminOnly}::boolean OR kr.visibility = 'lab')
      AND (${recordType}::text IS NULL OR kr.record_type = ${recordType})
      AND (${studentId}::uuid IS NULL OR krp.student_id = ${studentId}::uuid)
      AND (${sessionKey}::text IS NULL OR kr.session_key = ${sessionKey})
      AND (${from}::date IS NULL OR kr.occurred_at >= ${from}::date)
      AND (${to}::date IS NULL OR kr.occurred_at < (${to}::date + INTERVAL '1 day'))
      AND (${qPattern}::text IS NULL OR (
        kr.title ILIKE ${qPattern} ESCAPE '\\'
        OR kr.body_text ILIKE ${qPattern} ESCAPE '\\'
        OR kr.summary_text ILIKE ${qPattern} ESCAPE '\\'
        OR kr.decisions_text ILIKE ${qPattern} ESCAPE '\\'
        OR kr.next_actions_text ILIKE ${qPattern} ESCAPE '\\'
      ))
    ORDER BY kr.occurred_at DESC, kr.created_at DESC
    LIMIT ${limit}
  `;

  const ids = rows.map((r) => r.id);
  const partMap = await loadParticipantsForRecords(sql, ids);
  return rows.map((r) => mapKnowledgeRecordRow(r, partMap.get(r.id) || []));
}

async function resolveParticipantNames(participants) {
  const out = [];
  for (const p of participants || []) {
    const studentId = p.student_id || p.studentId || null;
    let name = String(p.participant_name || p.participantName || p.name || '').trim();
    if (studentId && !name) {
      const st = await findStudentById(studentId);
      name = st?.display_name || st?.name || '名前未設定';
    }
    if (!name) continue;
    out.push({ student_id: studentId, participant_name: name });
  }
  return out;
}

export async function createKnowledgeRecord(user, body) {
  const sql = getDb();
  const typeResult = parseRecordType(body.record_type || body.recordType, { required: true });
  if (!typeResult.ok) throw Object.assign(new Error(typeResult.error), { status: 400 });

  const title = String(body.title || '').trim();
  if (!title) throw Object.assign(new Error('title は必須です'), { status: 400 });

  const occurredResult = parseOccurredAt(body.occurred_at || body.occurredAt);
  if (!occurredResult.ok) throw Object.assign(new Error(occurredResult.error), { status: 400 });

  const visResult = parseKnowledgeVisibility(body.visibility || 'lab', { required: true });
  if (!visResult.ok) throw Object.assign(new Error(visResult.error), { status: 400 });

  const skResult = parseSessionKey(body.session_key ?? body.sessionKey);
  if (!skResult.ok) throw Object.assign(new Error(skResult.error), { status: 400 });

  const bodyText = String(body.body_text ?? body.bodyText ?? '').trim();
  if (!bodyText) throw Object.assign(new Error('body_text は必須です'), { status: 400 });

  const norm = (v) => {
    const s = String(v ?? '').trim();
    return s || null;
  };

  const rows = await sql`
    INSERT INTO knowledge_records (
      record_type, title, occurred_at, session_key,
      body_text, summary_text, decisions_text, next_actions_text,
      visibility, created_by
    ) VALUES (
      ${typeResult.value},
      ${title},
      ${occurredResult.value},
      ${skResult.value},
      ${bodyText},
      ${norm(body.summary_text ?? body.summaryText)},
      ${norm(body.decisions_text ?? body.decisionsText)},
      ${norm(body.next_actions_text ?? body.nextActionsText)},
      ${visResult.value},
      ${user.email || null}
    )
    RETURNING id, record_type, title, occurred_at, session_key,
              body_text, summary_text, decisions_text, next_actions_text,
              visibility, created_by, created_at, updated_at
  `;

  const record = rows[0];
  const participants = await resolveParticipantNames(body.participants);
  for (const p of participants) {
    await sql`
      INSERT INTO knowledge_record_participants (record_id, student_id, participant_name)
      VALUES (${record.id}, ${p.student_id}, ${p.participant_name})
    `;
  }

  return findKnowledgeRecordById(record.id);
}

export async function updateKnowledgeRecord(user, id, body) {
  const existing = await findKnowledgeRecordById(id);
  if (!existing) throw Object.assign(new Error('Record not found'), { status: 404 });
  if (!canViewKnowledgeRecord(user, existing)) {
    throw Object.assign(new Error('Forbidden'), { status: 403 });
  }

  const sql = getDb();
  const fields = {};

  if (body.record_type !== undefined || body.recordType !== undefined) {
    const r = parseRecordType(body.record_type || body.recordType, { required: true });
    if (!r.ok) throw Object.assign(new Error(r.error), { status: 400 });
    fields.record_type = r.value;
  }
  if (body.title !== undefined) {
    const t = String(body.title).trim();
    if (!t) throw Object.assign(new Error('title は空にできません'), { status: 400 });
    fields.title = t;
  }
  if (body.occurred_at !== undefined || body.occurredAt !== undefined) {
    const o = parseOccurredAt(body.occurred_at || body.occurredAt);
    if (!o.ok) throw Object.assign(new Error(o.error), { status: 400 });
    fields.occurred_at = o.value;
  }
  if (body.session_key !== undefined || body.sessionKey !== undefined) {
    const sk = parseSessionKey(body.session_key ?? body.sessionKey);
    if (!sk.ok) throw Object.assign(new Error(sk.error), { status: 400 });
    fields.session_key = sk.value;
  }
  if (body.body_text !== undefined || body.bodyText !== undefined) {
    const bt = String(body.body_text ?? body.bodyText).trim();
    if (!bt) throw Object.assign(new Error('body_text は空にできません'), { status: 400 });
    fields.body_text = bt;
  }
  if (body.summary_text !== undefined || body.summaryText !== undefined) {
    fields.summary_text = String(body.summary_text ?? body.summaryText ?? '').trim() || null;
  }
  if (body.decisions_text !== undefined || body.decisionsText !== undefined) {
    fields.decisions_text = String(body.decisions_text ?? body.decisionsText ?? '').trim() || null;
  }
  if (body.next_actions_text !== undefined || body.nextActionsText !== undefined) {
    fields.next_actions_text = String(body.next_actions_text ?? body.nextActionsText ?? '').trim() || null;
  }
  if (body.visibility !== undefined) {
    const v = parseKnowledgeVisibility(body.visibility, { required: true });
    if (!v.ok) throw Object.assign(new Error(v.error), { status: 400 });
    fields.visibility = v.value;
  }

  if (Object.keys(fields).length) {
    await sql`
      UPDATE knowledge_records SET
        record_type = COALESCE(${fields.record_type ?? null}, record_type),
        title = COALESCE(${fields.title ?? null}, title),
        occurred_at = COALESCE(${fields.occurred_at ?? null}, occurred_at),
        session_key = COALESCE(${fields.session_key ?? null}, session_key),
        body_text = COALESCE(${fields.body_text ?? null}, body_text),
        summary_text = COALESCE(${fields.summary_text ?? null}, summary_text),
        decisions_text = COALESCE(${fields.decisions_text ?? null}, decisions_text),
        next_actions_text = COALESCE(${fields.next_actions_text ?? null}, next_actions_text),
        visibility = COALESCE(${fields.visibility ?? null}, visibility)
      WHERE id = ${id}
    `;
  }

  if (body.participants !== undefined) {
    await sql`DELETE FROM knowledge_record_participants WHERE record_id = ${id}`;
    const participants = await resolveParticipantNames(body.participants);
    for (const p of participants) {
      await sql`
        INSERT INTO knowledge_record_participants (record_id, student_id, participant_name)
        VALUES (${id}, ${p.student_id}, ${p.participant_name})
      `;
    }
  }

  return findKnowledgeRecordById(id);
}

export async function deleteKnowledgeRecord(user, id) {
  const existing = await findKnowledgeRecordById(id);
  if (!existing) throw Object.assign(new Error('Record not found'), { status: 404 });
  if (!canViewKnowledgeRecord(user, existing)) {
    throw Object.assign(new Error('Forbidden'), { status: 403 });
  }
  const sql = getDb();
  await sql`DELETE FROM knowledge_records WHERE id = ${id}`;
  return { ok: true };
}
