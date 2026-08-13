/**
 * メンバー分析 UI — 純粋関数（lab_manager.html と tests で共有）
 *
 * MEMBER select の source of truth は Neon students のみ。
 * psych_assessments / respondent_name から MEMBER option を作らない。
 */

/** display_name / name / email の順。文字列 "null" は無効扱い */
export function resolveStudentLabel(student) {
  const displayName = String(student?.display_name ?? '').trim();
  const name = String(student?.name ?? '').trim();
  const email = String(student?.email ?? '').trim();

  const pick = (v) => (v && v !== 'null' && v !== 'undefined' ? v : '');
  return pick(displayName) || pick(name) || pick(email) || '名前未設定';
}

/** Neon students → MEMBER option 候補（id 必須・role=student） */
export function getMemberAnalysisStudentOptions(students) {
  return (students || [])
    .filter((s) => s && s.role === 'student' && String(s?.id || '').trim())
    .map((s) => ({
      id: String(s.id).trim(),
      name: resolveStudentLabel(s),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ja'));
}

/**
 * MEMBER select 用 options（students のみ）
 * @returns {{ value: string, label: string }[]}
 */
export function buildMemberSelectOptionsFromStudents(students) {
  return getMemberAnalysisStudentOptions(students).map((s) => ({
    value: s.id,
    label: s.name,
  }));
}

/**
 * GET /api/students レスポンスのみを member-analysis 用に正規化（legacy merge 禁止）
 */
export function normalizeMemberAnalysisStudentsFromApi(students) {
  return (students || [])
    .filter((s) => s && s.role === 'student' && String(s?.id || '').trim())
    .map((s) => ({
      id: String(s.id).trim(),
      role: 'student',
      name: s.name,
      display_name: s.display_name,
      email: s.email,
    }));
}

/**
 * 誤用防止: assessments から MEMBER を生成してはならない
 * @param {unknown} _assessments
 */
export function assertMemberSelectNotFromAssessments(_assessments) {
  if (_assessments != null && (Array.isArray(_assessments) ? _assessments.length : true)) {
    // 呼び出し側が assessments を渡したらテスト/開発時に検知
    return false;
  }
  return true;
}

/** @returns {{ memberId: string|null, options: Array<{id:string,name:string}> }} */
export function resolveMemberSelectState(members, previousMemberId) {
  if (!members.length) {
    return { memberId: null, options: [] };
  }
  const prev = String(previousMemberId || '').trim();
  const memberId = prev && members.some((m) => m.id === prev) ? prev : members[0].id;
  return { memberId, options: members };
}

export function shouldFetchMemberAssessments(studentId) {
  return !!String(studentId || '').trim();
}

/** psych_assessments 行 → assessment select 用（student_id=null は除外） */
export function mapAssessmentRowToOption(row) {
  if (!row || !row.id || !row.student_id) return null;
  const assessedAt = row.answered_at ? String(row.answered_at).slice(0, 10) : '';
  return {
    id: String(row.id),
    memberId: String(row.student_id),
    assessedAt,
    scores: row.scores || {},
  };
}

/** @returns {{ assessmentId: string|null, options: object[] }} */
export function resolveAssessmentSelectState(assessments, previousAssessmentId) {
  const options = (assessments || [])
    .map(mapAssessmentRowToOption)
    .filter(Boolean);
  if (!options.length) {
    return { assessmentId: null, options: [] };
  }
  const prev = String(previousAssessmentId || '').trim();
  const assessmentId = prev && options.some((o) => o.id === prev) ? prev : options[0].id;
  return { assessmentId, options };
}

export function buildMemberAnalysisViewModelFromOption(option, resolveName) {
  if (!option) return null;
  return {
    memberId: option.memberId,
    memberName: resolveName(option.memberId),
    assessedAt: option.assessedAt,
    assessmentId: option.id,
    scores: option.scores,
  };
}

export function formatMemberAnalysisDateLabel(isoDate) {
  if (!isoDate) return '—';
  const [y, m, d] = String(isoDate).split('-');
  if (!y || !m || !d) return isoDate;
  return `${y}.${m}.${d}`;
}

/** member option HTML — value は必ず students.id */
export function renderMemberSelectOptions(members, selectedId) {
  return members.map((m) =>
    `<option value="${escapeAttr(m.id)}"${m.id === selectedId ? ' selected' : ''}>${escapeHtml(m.name)}</option>`,
  ).join('');
}

export function renderAssessmentSelectOptions(options, selectedId, formatDate) {
  const fmt = formatDate || formatMemberAnalysisDateLabel;
  return options.map((o) =>
    `<option value="${escapeAttr(o.id)}"${o.id === selectedId ? ' selected' : ''}>${escapeHtml(fmt(o.assessedAt))}</option>`,
  ).join('');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/'/g, '&#39;');
}
