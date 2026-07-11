import { getDb } from './lib/db.js';
import { requireSession } from './lib/auth.js';
import { withCors, readJsonBody } from './lib/http.js';

const VALID_VISIBILITY = ['private', 'lab', 'public'];

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
    time_spent: row.time_spent,
    work_location: row.work_location,
    visibility: row.visibility,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export default withCors(async (req, res) => {
  // requireSession は未ログインなら 401 を投げる
  const user = await requireSession(req);
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
               drive_link, time_spent, work_location, visibility, created_at, updated_at
        FROM daily_reports
        ORDER BY report_date DESC, created_at DESC
        LIMIT ${limit}
      `;
    } else if (view === 'lab') {
      // 研究室共有ビュー: lab / public のみ。private は本人・教員以外に出さない。
      rows = await sql`
        SELECT id, report_date, student_name, student_email,
               did_today, went_well, stuck_points, next_action, related_project,
               drive_link, time_spent, work_location, visibility, created_at, updated_at
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
               drive_link, time_spent, work_location, visibility, created_at, updated_at
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

    // student は自分のメールで投稿する。admin のみ代理投稿で氏名・メールを指定可能。
    const studentName = user.role === 'admin' && body.student_name
      ? String(body.student_name).trim()
      : user.name;
    const studentEmail = user.role === 'admin' && body.student_email
      ? String(body.student_email).trim().toLowerCase()
      : user.email;

    const norm = (v) => {
      const s = (v ?? '').toString().trim();
      return s === '' ? null : s;
    };

    const rows = await sql`
      INSERT INTO daily_reports (
        report_date, student_id, student_name, student_email,
        did_today, went_well, stuck_points, next_action, related_project,
        drive_link, time_spent, work_location, visibility
      ) VALUES (
        ${reportDate},
        ${user.studentId},
        ${studentName},
        ${studentEmail},
        ${didToday},
        ${norm(body.went_well || body.wentWell)},
        ${norm(body.stuck_points || body.stuckPoints)},
        ${norm(body.next_action || body.nextAction)},
        ${norm(body.related_project || body.relatedProject)},
        ${norm(body.drive_link || body.driveLink)},
        ${norm(body.time_spent || body.timeSpent)},
        ${norm(body.work_location || body.workLocation)},
        ${visibility}
      )
      RETURNING id, report_date, student_name, student_email,
                did_today, went_well, stuck_points, next_action, related_project,
                drive_link, time_spent, work_location, visibility, created_at, updated_at
    `;

    res.status(201).json({ report: mapReportRow(rows[0]) });
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
});
