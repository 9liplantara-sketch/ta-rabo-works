import { getDb, findStudentByEmail, findStudentById } from './db.js';
import { enrichUserFromDb, getPublicDisplayName } from './auth.js';

export const VALID_VISIBILITY = ['private', 'lab', 'public'];
const VALID_ATTACHMENT_TYPES = ['image', 'pdf', 'video', 'other'];
const MAX_ATTACHMENTS = 20;

export function sanitizeAttachments(input) {
  if (!Array.isArray(input)) return [];
  const clip = (v, max) => {
    const s = (v ?? '').toString().trim();
    return s ? s.slice(0, max) : '';
  };
  const out = [];
  for (const item of input) {
    if (!item || typeof item !== 'object') continue;
    const url = clip(item.url, 2000);
    if (!/^https?:\/\//i.test(url)) continue;
    let type = clip(item.type, 20).toLowerCase();
    if (!VALID_ATTACHMENT_TYPES.includes(type)) type = 'other';
    out.push({
      title: clip(item.title, 200),
      url,
      type,
      note: clip(item.note, 500),
    });
    if (out.length >= MAX_ATTACHMENTS) break;
  }
  return out;
}

export function parseAttachments(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const v = JSON.parse(value);
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  }
  return [];
}

export function mapReportRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    report_date: row.report_date,
    student_id: row.student_id,
    student_name: row.student_name,
    student_email: row.student_email,
    did_today: row.did_today,
    went_well: row.went_well,
    stuck_points: row.stuck_points,
    next_action: row.next_action,
    related_project: row.related_project,
    drive_link: row.drive_link,
    attachments: parseAttachments(row.attachments),
    time_spent: row.time_spent,
    work_location: row.work_location,
    visibility: row.visibility,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function normOptional(value) {
  const s = (value ?? '').toString().trim();
  return s === '' ? null : s;
}

export function parseVisibility(raw, { required = false } = {}) {
  if (raw === undefined || raw === null || raw === '') {
    if (required) return { ok: false, error: 'visibility は必須です' };
    return { ok: true, value: null };
  }
  const visibility = String(raw).toLowerCase();
  if (!VALID_VISIBILITY.includes(visibility)) {
    return { ok: false, error: `visibility は ${VALID_VISIBILITY.join(' / ')} のいずれか` };
  }
  return { ok: true, value: visibility };
}

/** ILIKE 用。ユーザー入力の % _ \ をエスケープする */
export function toIlikePattern(term) {
  const raw = String(term ?? '').trim();
  if (!raw) return null;
  const escaped = raw.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
  return `%${escaped}%`;
}

export function parseDateParam(value) {
  const s = String(value ?? '').trim();
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return { invalid: true, value: s };
  return { invalid: false, value: s };
}

export function parseListParams(query = {}) {
  const view = String(query.view || 'mine').toLowerCase();
  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 100);
  const offset = Math.max(Number(query.offset) || 0, 0);
  const q = String(query.q || '').trim();

  const fromRaw = parseDateParam(query.from);
  const toRaw = parseDateParam(query.to);
  if (fromRaw?.invalid || toRaw?.invalid) {
    const err = new Error('from / to は YYYY-MM-DD 形式で指定してください');
    err.status = 400;
    throw err;
  }

  const project = String(query.project || '').trim();
  const studentId = String(query.student_id || query.studentId || '').trim() || null;
  // Phase 2a: session_id フィルタをここに追加予定

  return {
    view,
    limit,
    offset,
    q,
    from: fromRaw?.value ?? null,
    to: toRaw?.value ?? null,
    project,
    studentId,
  };
}

function emailsMatch(a, b) {
  return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
}

/** 一覧・1件 GET 用の閲覧権限 */
export function canViewReport(user, row) {
  if (!row) return false;
  if (user.role === 'admin') return true;
  if (emailsMatch(row.student_email, user.email)) return true;
  return row.visibility === 'lab' || row.visibility === 'public';
}

/** PATCH 用：本人または admin のみ */
export function canEditReport(user, row) {
  if (!row) return false;
  if (user.role === 'admin') return true;
  return emailsMatch(row.student_email, user.email);
}

export async function findDailyReportById(id) {
  const sql = getDb();
  const rows = await sql`
    SELECT id, report_date, student_id, student_name, student_email,
           did_today, went_well, stuck_points, next_action, related_project,
           drive_link, attachments, time_spent, work_location, visibility,
           created_at, updated_at
    FROM daily_reports
    WHERE id = ${id}
    LIMIT 1
  `;
  return rows[0] || null;
}

async function queryReports(sql, {
  view,
  user,
  studentId,
  fromDate,
  toDate,
  projectPattern,
  qPattern,
  limit,
  offset,
}) {
  if (view === 'all') {
    return sql`
      SELECT id, report_date, student_id, student_name, student_email,
             did_today, went_well, stuck_points, next_action, related_project,
             drive_link, attachments, time_spent, work_location, visibility,
             created_at, updated_at
      FROM daily_reports
      WHERE (${studentId}::uuid IS NULL OR student_id = ${studentId}::uuid)
        AND (${fromDate}::date IS NULL OR report_date >= ${fromDate}::date)
        AND (${toDate}::date IS NULL OR report_date <= ${toDate}::date)
        AND (${projectPattern}::text IS NULL OR related_project ILIKE ${projectPattern} ESCAPE '\\')
        AND (${qPattern}::text IS NULL OR (
          did_today ILIKE ${qPattern} ESCAPE '\\'
          OR went_well ILIKE ${qPattern} ESCAPE '\\'
          OR stuck_points ILIKE ${qPattern} ESCAPE '\\'
          OR next_action ILIKE ${qPattern} ESCAPE '\\'
          OR related_project ILIKE ${qPattern} ESCAPE '\\'
        ))
      ORDER BY report_date DESC, created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;
  }

  if (view === 'lab') {
    return sql`
      SELECT id, report_date, student_id, student_name, student_email,
             did_today, went_well, stuck_points, next_action, related_project,
             drive_link, attachments, time_spent, work_location, visibility,
             created_at, updated_at
      FROM daily_reports
      WHERE visibility IN ('lab', 'public')
        AND (${studentId}::uuid IS NULL OR student_id = ${studentId}::uuid)
        AND (${fromDate}::date IS NULL OR report_date >= ${fromDate}::date)
        AND (${toDate}::date IS NULL OR report_date <= ${toDate}::date)
        AND (${projectPattern}::text IS NULL OR related_project ILIKE ${projectPattern} ESCAPE '\\')
        AND (${qPattern}::text IS NULL OR (
          did_today ILIKE ${qPattern} ESCAPE '\\'
          OR went_well ILIKE ${qPattern} ESCAPE '\\'
          OR stuck_points ILIKE ${qPattern} ESCAPE '\\'
          OR next_action ILIKE ${qPattern} ESCAPE '\\'
          OR related_project ILIKE ${qPattern} ESCAPE '\\'
        ))
      ORDER BY report_date DESC, created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;
  }

  return sql`
    SELECT id, report_date, student_id, student_name, student_email,
           did_today, went_well, stuck_points, next_action, related_project,
           drive_link, attachments, time_spent, work_location, visibility,
           created_at, updated_at
    FROM daily_reports
    WHERE lower(student_email) = lower(${user.email})
      AND (${fromDate}::date IS NULL OR report_date >= ${fromDate}::date)
      AND (${toDate}::date IS NULL OR report_date <= ${toDate}::date)
      AND (${projectPattern}::text IS NULL OR related_project ILIKE ${projectPattern} ESCAPE '\\')
      AND (${qPattern}::text IS NULL OR (
        did_today ILIKE ${qPattern} ESCAPE '\\'
        OR went_well ILIKE ${qPattern} ESCAPE '\\'
        OR stuck_points ILIKE ${qPattern} ESCAPE '\\'
        OR next_action ILIKE ${qPattern} ESCAPE '\\'
        OR related_project ILIKE ${qPattern} ESCAPE '\\'
      ))
    ORDER BY report_date DESC, created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `;
}

export async function listDailyReports(user, params) {
  const { view, limit, offset, q, from, to, project, studentId } = params;
  const sql = getDb();

  if (view === 'all' && user.role !== 'admin') {
    const err = new Error('Forbidden: admin only');
    err.status = 403;
    throw err;
  }
  if (studentId && user.role !== 'admin') {
    const err = new Error('Forbidden: student_id filter is admin only');
    err.status = 403;
    throw err;
  }

  const rows = await queryReports(sql, {
    view,
    user,
    studentId,
    fromDate: from,
    toDate: to,
    projectPattern: toIlikePattern(project),
    qPattern: toIlikePattern(q),
    limit: limit + 1,
    offset,
  });

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;

  return {
    reports: pageRows.map(mapReportRow),
    limit,
    offset,
    has_more: hasMore,
  };
}

export async function createDailyReport(user, body) {
  const sql = getDb();
  const reportDate = body.report_date || body.reportDate;
  const didToday = (body.did_today || body.didToday || '').trim();

  if (!reportDate || !didToday) {
    const err = new Error('report_date と did_today は必須です');
    err.status = 400;
    throw err;
  }

  const visResult = parseVisibility(body.visibility || 'private', { required: true });
  if (!visResult.ok) {
    const err = new Error(visResult.error);
    err.status = 400;
    throw err;
  }

  let studentEmail = user.email;
  let studentName;
  let studentId = user.studentId;

  if (user.role === 'admin' && body.student_email) {
    studentEmail = String(body.student_email).trim().toLowerCase();
    const proxy = await findStudentByEmail(studentEmail);
    studentName = body.student_name
      ? String(body.student_name).trim()
      : (proxy ? (proxy.display_name || proxy.name) : getPublicDisplayName(user));
    studentId = proxy?.id || user.studentId;
  } else {
    const fresh = await enrichUserFromDb(user);
    const dbStudent = fresh.studentId
      ? await findStudentById(fresh.studentId)
      : await findStudentByEmail(fresh.email);
    if (dbStudent) {
      studentEmail = dbStudent.email;
      studentName = dbStudent.display_name || dbStudent.name;
      studentId = dbStudent.id;
    } else {
      studentName = getPublicDisplayName(fresh);
    }
  }

  const attachments = sanitizeAttachments(body.attachments);

  const rows = await sql`
    INSERT INTO daily_reports (
      report_date, student_id, student_name, student_email,
      did_today, went_well, stuck_points, next_action, related_project,
      drive_link, attachments, time_spent, work_location, visibility
    ) VALUES (
      ${reportDate},
      ${studentId},
      ${studentName},
      ${studentEmail},
      ${didToday},
      ${normOptional(body.went_well || body.wentWell)},
      ${normOptional(body.stuck_points || body.stuckPoints)},
      ${normOptional(body.next_action || body.nextAction)},
      ${normOptional(body.related_project || body.relatedProject)},
      ${normOptional(body.drive_link || body.driveLink)},
      ${JSON.stringify(attachments)}::jsonb,
      ${normOptional(body.time_spent || body.timeSpent)},
      ${normOptional(body.work_location || body.workLocation)},
      ${visResult.value}
    )
    RETURNING id, report_date, student_id, student_name, student_email,
              did_today, went_well, stuck_points, next_action, related_project,
              drive_link, attachments, time_spent, work_location, visibility,
              created_at, updated_at
  `;

  return mapReportRow(rows[0]);
}

export async function updateDailyReport(user, id, body) {
  const existing = await findDailyReportById(id);
  if (!existing) {
    const err = new Error('Report not found');
    err.status = 404;
    throw err;
  }
  if (!canEditReport(user, existing)) {
    const err = new Error('Forbidden');
    err.status = 403;
    throw err;
  }

  const reportDate = body.report_date !== undefined
    ? (body.report_date || body.reportDate)
    : existing.report_date;
  const didToday = body.did_today !== undefined || body.didToday !== undefined
    ? (body.did_today || body.didToday || '').trim()
    : existing.did_today;

  if (!reportDate || !didToday) {
    const err = new Error('report_date と did_today は必須です');
    err.status = 400;
    throw err;
  }

  let visibility = existing.visibility;
  if (body.visibility !== undefined) {
    const visResult = parseVisibility(body.visibility, { required: true });
    if (!visResult.ok) {
      const err = new Error(visResult.error);
      err.status = 400;
      throw err;
    }
    visibility = visResult.value;
  }

  const pick = (snake, camel, fallback) => {
    if (body[snake] !== undefined || body[camel] !== undefined) {
      return normOptional(body[snake] ?? body[camel]);
    }
    return fallback;
  };

  const attachments = body.attachments !== undefined
    ? sanitizeAttachments(body.attachments)
    : parseAttachments(existing.attachments);

  const sql = getDb();
  const rows = await sql`
    UPDATE daily_reports SET
      report_date = ${reportDate},
      did_today = ${didToday},
      went_well = ${pick('went_well', 'wentWell', existing.went_well)},
      stuck_points = ${pick('stuck_points', 'stuckPoints', existing.stuck_points)},
      next_action = ${pick('next_action', 'nextAction', existing.next_action)},
      related_project = ${pick('related_project', 'relatedProject', existing.related_project)},
      drive_link = ${pick('drive_link', 'driveLink', existing.drive_link)},
      attachments = ${JSON.stringify(attachments)}::jsonb,
      time_spent = ${pick('time_spent', 'timeSpent', existing.time_spent)},
      work_location = ${pick('work_location', 'workLocation', existing.work_location)},
      visibility = ${visibility}
    WHERE id = ${id}
    RETURNING id, report_date, student_id, student_name, student_email,
              did_today, went_well, stuck_points, next_action, related_project,
              drive_link, attachments, time_spent, work_location, visibility,
              created_at, updated_at
  `;

  return mapReportRow(rows[0]);
}
