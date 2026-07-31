import { neon } from '@neondatabase/serverless';

let sql;

export function getDb() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not configured');
  }
  if (!sql) sql = neon(process.env.DATABASE_URL);
  return sql;
}

// students の取得カラム。Neon serverless の tagged template では ${...} は必ず
// パラメータ（値）に変換され、識別子（列名）の差し込みには使えないため、各クエリに
// リテラルで直書きする。列を増減するときは各クエリの SELECT / RETURNING も更新すること。

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
    login_enabled: row.login_enabled,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function findStudentByEmail(email) {
  const sql = getDb();
  // email 未設定（NULL）の学生は照合対象外。空文字で誤ヒットしないよう明示的に弾く。
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) return null;
  const rows = await sql`
    SELECT id, name, email, role, display_name, note, icon_color,
           enrolled_at, is_active, login_enabled, created_at, updated_at
    FROM students
    WHERE email IS NOT NULL AND lower(email) = ${normalized}
    LIMIT 1
  `;
  return mapStudentRow(rows[0]);
}

export async function findStudentById(id) {
  const sql = getDb();
  const rows = await sql`
    SELECT id, name, email, role, display_name, note, icon_color,
           enrolled_at, is_active, login_enabled, created_at, updated_at
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
      SELECT id, name, email, role, display_name, note, icon_color,
             enrolled_at, is_active, login_enabled, created_at, updated_at
      FROM students
      WHERE is_active = TRUE
      ORDER BY role DESC, name ASC
    `;
    return rows.map(mapStudentRow);
  }
  const rows = await sql`
    SELECT id, name, email, role, display_name, note, icon_color,
           enrolled_at, is_active, login_enabled, created_at, updated_at
    FROM students
    ORDER BY role DESC, name ASC
  `;
  return rows.map(mapStudentRow);
}

export async function createStudent({ name, email = null, role = 'student', displayName = null, note = null, iconColor = null, loginEnabled = false }) {
  const sql = getDb();
  // email は任意。空文字・未指定は NULL として保存する（メール未設定の学生を登録できる）。
  const normalizedEmail = email ? String(email).trim().toLowerCase() || null : null;
  // メール未設定ではログインできないため、login_enabled は必ず false に矯正する。
  const canLogin = normalizedEmail ? Boolean(loginEnabled) : false;

  // email が NULL の場合、ON CONFLICT(email) は NULL 同士を重複扱いしないため常に INSERT される。
  // email がある場合のみ重複を UPDATE で吸収する。
  if (normalizedEmail) {
    const rows = await sql`
      INSERT INTO students (name, email, role, display_name, note, icon_color, login_enabled)
      VALUES (${name}, ${normalizedEmail}, ${role}, ${displayName}, ${note}, ${iconColor}, ${canLogin})
      ON CONFLICT (email) DO UPDATE SET
        name = EXCLUDED.name,
        role = EXCLUDED.role,
        is_active = TRUE,
        updated_at = NOW()
      RETURNING id, name, email, role, display_name, note, icon_color,
                enrolled_at, is_active, login_enabled, created_at, updated_at
    `;
    return mapStudentRow(rows[0]);
  }

  const rows = await sql`
    INSERT INTO students (name, email, role, display_name, note, icon_color, login_enabled)
    VALUES (${name}, NULL, ${role}, ${displayName}, ${note}, ${iconColor}, FALSE)
    RETURNING id, name, email, role, display_name, note, icon_color,
              enrolled_at, is_active, login_enabled, created_at, updated_at
  `;
  return mapStudentRow(rows[0]);
}

export async function updateStudent(id, fields = {}) {
  const sql = getDb();

  const nameProvided = Object.prototype.hasOwnProperty.call(fields, 'name');
  const roleProvided = Object.prototype.hasOwnProperty.call(fields, 'role');
  const displayNameProvided = Object.prototype.hasOwnProperty.call(fields, 'displayName');
  const noteProvided = Object.prototype.hasOwnProperty.call(fields, 'note');
  const iconColorProvided = Object.prototype.hasOwnProperty.call(fields, 'iconColor');
  const isActiveProvided = Object.prototype.hasOwnProperty.call(fields, 'isActive');
  const loginEnabledProvided = Object.prototype.hasOwnProperty.call(fields, 'loginEnabled');
  const emailProvided = Object.prototype.hasOwnProperty.call(fields, 'email');

  const emailValue = emailProvided
    ? (fields.email ? String(fields.email).trim().toLowerCase() || null : null)
    : null;

  const rows = await sql`
    UPDATE students SET
      name          = CASE WHEN ${nameProvided} THEN ${nameProvided ? fields.name : null} ELSE name END,
      email         = CASE WHEN ${emailProvided} THEN ${emailValue} ELSE email END,
      role          = CASE WHEN ${roleProvided} THEN ${roleProvided ? fields.role : null} ELSE role END,
      display_name  = CASE WHEN ${displayNameProvided} THEN ${displayNameProvided ? fields.displayName : null} ELSE display_name END,
      note          = CASE WHEN ${noteProvided} THEN ${noteProvided ? fields.note : null} ELSE note END,
      icon_color    = CASE WHEN ${iconColorProvided} THEN ${iconColorProvided ? fields.iconColor : null} ELSE icon_color END,
      is_active     = CASE WHEN ${isActiveProvided} THEN ${isActiveProvided ? fields.isActive : false} ELSE is_active END,
      login_enabled = CASE WHEN ${loginEnabledProvided} THEN ${loginEnabledProvided ? fields.loginEnabled : false} ELSE login_enabled END
    WHERE id = ${id}
    RETURNING id, name, email, role, display_name, note, icon_color,
              enrolled_at, is_active, login_enabled, created_at, updated_at
  `;
  return mapStudentRow(rows[0]);
}
