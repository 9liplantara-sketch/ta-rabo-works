import { neon } from '@neondatabase/serverless';

let sql;

export function getDb() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not configured');
  }
  if (!sql) sql = neon(process.env.DATABASE_URL);
  return sql;
}

export async function findStudentByEmail(email) {
  const sql = getDb();
  const rows = await sql`
    SELECT id, name, email, role, is_active
    FROM students
    WHERE lower(email) = lower(${email})
    LIMIT 1
  `;
  return rows[0] || null;
}
