import { getDb, findStudentByEmail, findStudentById } from './lib/db.js';
import { requireSession, enrichUserFromDb, getPublicDisplayName } from './lib/auth.js';
import { withCors, readJsonBody } from './lib/http.js';

const VALID_VISIBILITY = ['private', 'lab', 'public'];
const VALID_ATTACHMENT_TYPES = ['image', 'pdf', 'video', 'other'];
const MAX_ATTACHMENTS = 20;

// 添付リンク配列をサニタイズする。ファイル本体は外部（Google Drive 等）に置き、
// ここには URL・説明のみを保存する。不正な要素は除外し、安全な配列だけ返す。
function sanitizeAttachments(input) {
  if (!Array.isArray(input)) return [];
  const clip = (v, max) => {
    const s = (v ?? '').toString().trim();
    return s ? s.slice(0, max) : '';
  };
  const out = [];
  for (const item of input) {
    if (!item || typeof item !== 'object') continue;
    const url = clip(item.url, 2000);
    if (!/^https?:\/\//i.test(url)) continue; // URL 必須・http(s) のみ
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

// Neon(JSONB) は配列/オブジェクトで返るが、念のため文字列時もパースする。
function parseAttachments(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try { const v = JSON.parse(value); return Array.isArray(v) ? v : []; }
    catch { return []; }
  }
  return [];
}

function mapReportRow(row) {
  return {
    id: row.id,
    report_date: row.report_date,
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

export default withCors(async (req, res) => {
  // requireSession は未ログインなら 401 を投げる。
  // さらに enrichUserFromDb で最新の students 行を確認し、承認取消（is_active=false /
  // login_enabled=false）されたセッションは 403 で弾く（UI ロックだけに頼らず API 側でも保護）。
  const session = await requireSession(req);
  const user = await enrichUserFromDb(session);
  const sql = getDb();

  if (req.method === 'GET') {
    const limit = Math.min(Number(req.query?.limit) || 50, 100);
    // view: mine（本人）/ lab（研究室共有）/ all（教員のみ全件）
    const view = String(req.query?.view || 'mine').toLowerCase();

    let rows;
    if (view === 'all') {
      if (user.role !== 'admin') {
        res.status(403).json({ error: 'Forbidden: admin only' });
        return;
      }
      rows = await sql`
        SELECT id, report_date, student_name, student_email,
               did_today, went_well, stuck_points, next_action, related_project,
               drive_link, attachments, time_spent, work_location, visibility, created_at, updated_at
        FROM daily_reports
        ORDER BY report_date DESC, created_at DESC
        LIMIT ${limit}
      `;
    } else if (view === 'lab') {
      // 研究室共有ビュー: lab / public のみ。private は本人・教員以外に出さない。
      rows = await sql`
        SELECT id, report_date, student_name, student_email,
               did_today, went_well, stuck_points, next_action, related_project,
               drive_link, attachments, time_spent, work_location, visibility, created_at, updated_at
        FROM daily_reports
        WHERE visibility IN ('lab', 'public')
        ORDER BY report_date DESC, created_at DESC
        LIMIT ${limit}
      `;
    } else {
      // view=mine（既定）: 本人の日報のみ
      rows = await sql`
        SELECT id, report_date, student_name, student_email,
               did_today, went_well, stuck_points, next_action, related_project,
               drive_link, attachments, time_spent, work_location, visibility, created_at, updated_at
        FROM daily_reports
        WHERE lower(student_email) = lower(${user.email})
        ORDER BY report_date DESC, created_at DESC
        LIMIT ${limit}
      `;
    }

    res.status(200).json({ reports: rows.map(mapReportRow), view });
    return;
  }

  if (req.method === 'POST') {
    const body = readJsonBody(req);
    const reportDate = body.report_date || body.reportDate;
    const didToday = (body.did_today || body.didToday || '').trim();

    // 最低限のバリデーション: 日付と「今日やったこと」は必須。空の日報は保存しない。
    if (!reportDate || !didToday) {
      res.status(400).json({ error: 'report_date と did_today は必須です' });
      return;
    }

    // 公開範囲: 未指定なら private。不正値は拒否。
    let visibility = (body.visibility || 'private').toLowerCase();
    if (!VALID_VISIBILITY.includes(visibility)) {
      res.status(400).json({ error: `visibility は ${VALID_VISIBILITY.join(' / ')} のいずれか` });
      return;
    }

    // 投稿者名は Neon students の display_name → name を優先（過去日報は更新しない）
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

    const norm = (v) => {
      const s = (v ?? '').toString().trim();
      return s === '' ? null : s;
    };

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
        ${norm(body.went_well || body.wentWell)},
        ${norm(body.stuck_points || body.stuckPoints)},
        ${norm(body.next_action || body.nextAction)},
        ${norm(body.related_project || body.relatedProject)},
        ${norm(body.drive_link || body.driveLink)},
        ${JSON.stringify(attachments)}::jsonb,
        ${norm(body.time_spent || body.timeSpent)},
        ${norm(body.work_location || body.workLocation)},
        ${visibility}
      )
      RETURNING id, report_date, student_name, student_email,
                did_today, went_well, stuck_points, next_action, related_project,
                drive_link, attachments, time_spent, work_location, visibility, created_at, updated_at
    `;

    res.status(201).json({ report: mapReportRow(rows[0]) });
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
});
