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

    res.status(200).json(out);
  } catch (e) {
    out.error = e.message || 'Database connection failed';
    res.status(503).json(out);
  }
});
