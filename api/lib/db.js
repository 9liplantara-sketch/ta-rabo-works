import { neon } from '@neondatabase/serverless';

let sql;

export function getDb() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not configured');
  }
  if (!sql) sql = neon(process.env.DATABASE_URL);
  return sql;
}

const STUDENT_COLUMNS = `id, name, email, role, display_name, note, icon_color,
                         enrolled_at, is_active, created_at, updated_at`;

export function mapStudentRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    display_name: row.display_name,
    note: row.note,
    icon_color: row.icon_color,
    enrolled_at: row.enrolled_at,
    is_active: row.is_active,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function findStudentByEmail(email) {
  const sql = getDb();
  const rows = await sql`
    SELECT ${sql.unsafe(STUDENT_COLUMNS)}
    FROM students
    WHERE lower(email) = lower(${email})
    LIMIT 1
  `;
  return mapStudentRow(rows[0]);
}

export async function findStudentById(id) {
  const sql = getDb();
  const rows = await sql`
    SELECT ${sql.unsafe(STUDENT_COLUMNS)}
    FROM students
    WHERE id = ${id}
    LIMIT 1
  `;
  return mapStudentRow(rows[0]);
}

export async function listStudents({ activeOnly = false } = {}) {
  const sql = getDb();
  if (activeOnly) {
    const rows = await sql`
      SELECT ${sql.unsafe(STUDENT_COLUMNS)}
      FROM students
      WHERE is_active = TRUE
      ORDER BY role DESC, name ASC
    `;
    return rows.map(mapStudentRow);
  }
  const rows = await sql`
    SELECT ${sql.unsafe(STUDENT_COLUMNS)}
    FROM students
    ORDER BY role DESC, name ASC
  `;
  return rows.map(mapStudentRow);
}

export async function createStudent({ name, email, role = 'student', displayName = null, note = null, iconColor = null }) {
  const sql = getDb();
  const normalizedEmail = String(email).trim().toLowerCase();
  const rows = await sql`
    INSERT INTO students (name, email, role, display_name, note, icon_color)
    VALUES (${name}, ${normalizedEmail}, ${role}, ${displayName}, ${note}, ${iconColor})
    ON CONFLICT (email) DO UPDATE SET
      name = EXCLUDED.name,
      role = EXCLUDED.role,
      is_active = TRUE,
      updated_at = NOW()
    RETURNING ${sql.unsafe(STUDENT_COLUMNS)}
  `;
  return mapStudentRow(rows[0]);
}

export async function updateStudent(id, fields = {}) {
  const sql = getDb();
  const {
    name = null,
    email = null,
    role = null,
    displayName = null,
    note = null,
    iconColor = null,
    isActive = null,
  } = fields;
  const rows = await sql`
    UPDATE students SET
      name         = COALESCE(${name}, name),
      email        = COALESCE(${email}, email),
      role         = COALESCE(${role}, role),
      display_name = COALESCE(${displayName}, display_name),
      note         = COALESCE(${note}, note),
      icon_color   = COALESCE(${iconColor}, icon_color),
      is_active    = COALESCE(${isActive}, is_active)
    WHERE id = ${id}
    RETURNING ${sql.unsafe(STUDENT_COLUMNS)}
  `;
  return mapStudentRow(rows[0]);
}
