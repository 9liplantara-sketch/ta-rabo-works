import {
  listStudents,
  findStudentById,
  createStudent,
  updateStudent,
} from './lib/db.js';
import { requireSession, enrichUserFromDb } from './lib/auth.js';
import { withCors, readJsonBody } from './lib/http.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function mapStudentForClient(row, { isAdmin = false } = {}) {
  const base = {
    id: row.id,
    name: row.name,
    display_name: row.display_name,
    email: row.email,
    role: row.role,
    icon_color: row.icon_color,
    is_active: row.is_active,
    login_enabled: row.login_enabled,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
  if (isAdmin) base.note = row.note;
  return base;
}

// email は任意。空欄なら null（未設定）扱い。値がある場合のみ形式を検証する。
// 戻り値: { ok:true, value:string|null } | { ok:false }
function normalizeOptionalEmail(email) {
  const v = String(email || '').trim().toLowerCase();
  if (!v) return { ok: true, value: null };
  if (!EMAIL_RE.test(v)) return { ok: false };
  return { ok: true, value: v };
}

export default withCors(async (req, res) => {
  const session = await requireSession(req);
  const user = await enrichUserFromDb(session);

  if (req.method === 'GET') {
    if (user.role === 'admin') {
      const students = await listStudents();
      res.status(200).json({
        students: students.map((s) => mapStudentForClient(s, { isAdmin: true })),
      });
      return;
    }
    // student: アクティブなメンバー一覧（最小限）＋自分の詳細
    const students = await listStudents({ activeOnly: true });
    const meRow = user.studentId
      ? (students.find((s) => s.id === user.studentId) || await findStudentById(user.studentId))
      : null;
    res.status(200).json({
      students: students.map((s) => mapStudentForClient(s)),
      me: meRow ? mapStudentForClient(meRow) : null,
    });
    return;
  }

  if (req.method === 'POST') {
    if (user.role !== 'admin') {
      res.status(403).json({ error: 'Forbidden: admin only' });
      return;
    }
    const body = readJsonBody(req);
    const name = String(body.name || '').trim();
    const emailResult = normalizeOptionalEmail(body.email);
    const role = String(body.role || 'student').toLowerCase();
    if (!name) {
      res.status(400).json({ error: 'name は必須です' });
      return;
    }
    if (!emailResult.ok) {
      res.status(400).json({ error: 'email の形式が正しくありません（空欄でも登録できます）' });
      return;
    }
    if (!['student', 'admin'].includes(role)) {
      res.status(400).json({ error: 'role は student または admin' });
      return;
    }
    // login_enabled は admin のみ設定可能。メール未設定ではログイン不可のため false に矯正。
    const loginEnabled = emailResult.value ? Boolean(body.login_enabled) : false;
    const student = await createStudent({
      name,
      email: emailResult.value,
      role,
      displayName: body.display_name ? String(body.display_name).trim() : null,
      note: body.note ? String(body.note).trim() : null,
      iconColor: body.icon_color ? String(body.icon_color).trim() : null,
      loginEnabled,
    });
    res.status(201).json({ student: mapStudentForClient(student, { isAdmin: true }) });
    return;
  }

  if (req.method === 'PATCH') {
    const body = readJsonBody(req);
    const targetId = body.id || req.query?.id;
    if (!targetId) {
      res.status(400).json({ error: 'id は必須です' });
      return;
    }

    const existing = await findStudentById(targetId);
    if (!existing) {
      res.status(404).json({ error: 'Student not found' });
      return;
    }

    if (user.role !== 'admin' && user.studentId !== targetId) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const fields = {};

    if (user.role === 'admin') {
      if (body.name !== undefined) {
        const name = String(body.name).trim();
        if (!name) { res.status(400).json({ error: 'name は空にできません' }); return; }
        fields.name = name;
      }
      if (body.display_name !== undefined) {
        const dn = String(body.display_name).trim();
        fields.displayName = dn === '' ? null : dn;
      }
      if (body.note !== undefined) {
        const n = String(body.note).trim();
        fields.note = n === '' ? null : n;
      }
      if (body.icon_color !== undefined) {
        const c = String(body.icon_color).trim();
        fields.iconColor = c === '' ? null : c;
      }
      if (body.email !== undefined) {
        // email は空欄可（null で保存 = メール未設定）。値がある場合のみ形式検証。
        const emailResult = normalizeOptionalEmail(body.email);
        if (!emailResult.ok) {
          res.status(400).json({ error: 'email の形式が正しくありません（空欄にすると未設定になります）' });
          return;
        }
        fields.email = emailResult.value;
      }
      if (body.role !== undefined) {
        const role = String(body.role).toLowerCase();
        if (!['student', 'admin'].includes(role)) {
          res.status(400).json({ error: 'role は student または admin' });
          return;
        }
        fields.role = role;
      }
      if (body.is_active !== undefined) {
        fields.isActive = Boolean(body.is_active);
      }
      // login_enabled は admin のみ変更可能。
      if (body.login_enabled !== undefined) {
        fields.loginEnabled = Boolean(body.login_enabled);
      }

      // ログイン許可を true にする場合は、更新後にメールが設定されている必要がある。
      // （メール未設定ではログインできないため矛盾を防ぐ）
      if (fields.loginEnabled === true) {
        const finalEmail = fields.email !== undefined ? fields.email : existing.email;
        if (!finalEmail) {
          res.status(400).json({ error: 'メール未設定の学生はログイン許可にできません。先に email を設定してください' });
          return;
        }
      }
      // メールを未設定(null)にする場合は、ログイン許可も自動的に false にする。
      if (fields.email === null) {
        fields.loginEnabled = false;
      }
    } else {
      // student: 自分の name / display_name のみ。email / role / is_active / login_enabled は不可。
      if (body.name !== undefined) {
        const name = String(body.name).trim();
        if (!name) { res.status(400).json({ error: 'name は空にできません' }); return; }
        fields.name = name;
      }
      if (body.display_name !== undefined) {
        const dn = String(body.display_name).trim();
        fields.displayName = dn === '' ? null : dn;
      }
      if (body.email !== undefined || body.role !== undefined || body.is_active !== undefined || body.note !== undefined || body.login_enabled !== undefined) {
        res.status(403).json({ error: 'email / role / is_active / login_enabled / note は教員のみ変更できます' });
        return;
      }
    }

    const updated = await updateStudent(targetId, fields);
    if (!updated) {
      res.status(404).json({ error: 'Student not found' });
      return;
    }
    const isAdmin = user.role === 'admin';
    res.status(200).json({ student: mapStudentForClient(updated, { isAdmin }) });
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
});
