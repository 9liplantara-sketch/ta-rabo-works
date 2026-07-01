import { getDb } from '../lib/db.js';
import { requireSession } from '../lib/auth.js';
import { withCors, readJsonBody } from '../lib/http.js';

function mapReportRow(row) {
  return {
    id: row.id,
    report_date: row.report_date,
    student_name: row.student_name,
    student_email: row.student_email,
    did_today: row.did_today,
    stuck_points: row.stuck_points,
    next_action: row.next_action,
    related_project: row.related_project,
    drive_link: row.drive_link,
    visibility: row.visibility,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export default withCors(async (req, res) => {
  const user = await requireSession(req);
  const sql = getDb();

  if (req.method === 'GET') {
    const limit = Math.min(Number(req.query?.limit) || 50, 100);
    let rows;
    if (user.role === 'admin') {
      rows = await sql`
        SELECT id, report_date, student_name, student_email,
               did_today, stuck_points, next_action, related_project,
               drive_link, visibility, created_at, updated_at
        FROM daily_reports
        ORDER BY report_date DESC, created_at DESC
        LIMIT ${limit}
      `;
    } else {
      rows = await sql`
        SELECT id, report_date, student_name, student_email,
               did_today, stuck_points, next_action, related_project,
               drive_link, visibility, created_at, updated_at
        FROM daily_reports
        WHERE lower(student_email) = lower(${user.email})
        ORDER BY report_date DESC, created_at DESC
        LIMIT ${limit}
      `;
    }
    res.status(200).json({ reports: rows.map(mapReportRow) });
    return;
  }

  if (req.method === 'POST') {
    const body = readJsonBody(req);
    const reportDate = body.report_date || body.reportDate;
    const didToday = (body.did_today || body.didToday || '').trim();
    if (!reportDate || !didToday) {
      res.status(400).json({ error: 'report_date and did_today are required' });
      return;
    }

    const studentName = user.role === 'admin' && body.student_name
      ? body.student_name.trim()
      : user.name;
    const studentEmail = user.role === 'admin' && body.student_email
      ? body.student_email.trim().toLowerCase()
      : user.email;

    const rows = await sql`
      INSERT INTO daily_reports (
        report_date, student_id, student_name, student_email,
        did_today, stuck_points, next_action, related_project,
        drive_link, visibility
      ) VALUES (
        ${reportDate},
        ${user.studentId},
        ${studentName},
        ${studentEmail},
        ${didToday},
        ${body.stuck_points || body.stuckPoints || null},
        ${body.next_action || body.nextAction || null},
        ${body.related_project || body.relatedProject || null},
        ${body.drive_link || body.driveLink || null},
        ${body.visibility || 'lab'}
      )
      RETURNING id, report_date, student_name, student_email,
                did_today, stuck_points, next_action, related_project,
                drive_link, visibility, created_at, updated_at
    `;

    res.status(201).json({ report: mapReportRow(rows[0]) });
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
});
