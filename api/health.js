import { getDb } from '../lib/db.js';
import { withCors } from '../lib/http.js';

export default withCors(async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const out = {
    ok: false,
    db: false,
    has_login_enabled_column: false,
    student_count: null,
    error: null,
  };

  try {
    if (!process.env.DATABASE_URL) {
      out.error = 'DATABASE_URL is not configured on Vercel';
      res.status(503).json(out);
      return;
    }

    const sql = getDb();
    const cols = await sql`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'students'
        AND column_name = 'login_enabled'
    `;
    out.has_login_enabled_column = cols.length > 0;

    const dailyReportsIdx = await sql`
      SELECT 1 FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'daily_reports'
        AND indexname = 'idx_daily_reports_student_date'
      LIMIT 1
    `;
    out.has_daily_reports_search_index = dailyReportsIdx.length > 0;

    const sessionsTable = await sql`
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'sessions'
      LIMIT 1
    `;
    out.has_sessions_table = sessionsTable.length > 0;
    if (out.has_sessions_table) {
      const sessionCounts = await sql`SELECT COUNT(*)::int AS n FROM sessions`;
      out.session_count = sessionCounts[0]?.n ?? 0;
    } else {
      out.session_count = null;
    }

    const counts = await sql`SELECT COUNT(*)::int AS n FROM students`;
    out.student_count = counts[0]?.n ?? 0;
    out.db = true;
    out.ok = out.has_login_enabled_column;

    if (!out.has_login_enabled_column) {
      out.error =
        'students.login_enabled 列がありません。Neon SQL Editor で db/migrations/2026-07-students-optional-email-and-login-approval.sql を実行してください。';
      res.status(503).json(out);
      return;
    }

    if (!out.has_daily_reports_search_index) {
      out.migration_hint =
        'Phase 1.5 検索用インデックス未適用。Neon SQL Editor で db/migrations/2026-08-daily-reports-search.sql を実行してください。';
    }

    if (!out.has_sessions_table) {
      out.sessions_migration_hint =
        'Phase 2a sessions 未適用。Neon SQL Editor で db/migrations/2026-08-sessions.sql を実行してください。';
    }

    const rows = await sql`
      SELECT name, email, role, is_active, login_enabled
      FROM students
      WHERE role = 'student'
      ORDER BY name ASC
    `;
    out.students = rows.map((row) => {
      const hasEmail = !!(row.email && String(row.email).trim());
      const active = row.is_active === true || row.is_active === 't';
      const loginEnabled = row.login_enabled === true || row.login_enabled === 't';
      const email = hasEmail ? String(row.email).trim().toLowerCase() : null;
      const domain = email && email.includes('@') ? email.split('@')[1] : null;
      return {
        name: row.name,
        email_hint: email ? `***@${domain}` : null,
        is_active: active,
        login_enabled: loginEnabled,
        login_ready: active && loginEnabled && hasEmail,
      };
    });

    res.status(200).json(out);
  } catch (e) {
    out.error = e.message || 'Database connection failed';
    res.status(503).json(out);
  }
});
