/**
 * メンバー分析 UI ロジック（lab_manager.html 用 · lib/member-analysis-ui-logic.js と同期）
 *
 * MEMBER select = Neon students のみ。psych_assessments から作らない。
 */
(function (global) {
  function resolveStudentLabel(student) {
    const displayName = String(student?.display_name ?? '').trim();
    const name = String(student?.name ?? '').trim();
    const email = String(student?.email ?? '').trim();
    const pick = (v) => (v && v !== 'null' && v !== 'undefined' ? v : '');
    return pick(displayName) || pick(name) || pick(email) || '名前未設定';
  }

  function isActiveMemberAnalysisMember(member) {
    const id = String(member?.id || '').trim();
    return !!id && member?.is_active !== false;
  }

  function getMemberAnalysisStudentOptions(students) {
    return (students || [])
      .filter((s) => s && isActiveMemberAnalysisMember(s))
      .map((s) => ({
        id: String(s.id).trim(),
        name: resolveStudentLabel(s),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  }

  function buildMemberSelectOptionsFromStudents(students) {
    return getMemberAnalysisStudentOptions(students).map((s) => ({
      value: s.id,
      label: s.name,
    }));
  }

  function normalizeMemberAnalysisStudentsFromApi(students) {
    return (students || [])
      .filter((s) => s && isActiveMemberAnalysisMember(s))
      .map((s) => ({
        id: String(s.id).trim(),
        role: s.role,
        name: s.name,
        display_name: s.display_name,
        email: s.email,
        is_active: s.is_active,
      }));
  }

  function shouldFetchMemberAssessments(studentId) {
    return !!String(studentId || '').trim();
  }

  function resolveMemberSelectState(members, previousMemberId) {
    if (!members.length) return { memberId: null, options: [] };
    const prev = String(previousMemberId || '').trim();
    const memberId = prev && members.some((m) => m.id === prev) ? prev : members[0].id;
    return { memberId, options: members };
  }

  function mapAssessmentRowToOption(row) {
    if (!row || !row.id || !row.student_id) return null;
    const assessedAt = row.answered_at ? String(row.answered_at).slice(0, 10) : '';
    return {
      id: String(row.id),
      memberId: String(row.student_id),
      assessedAt,
      scores: row.scores || {},
    };
  }

  function resolveAssessmentSelectState(assessments, previousAssessmentId) {
    const options = (assessments || []).map(mapAssessmentRowToOption).filter(Boolean);
    if (!options.length) return { assessmentId: null, options: [] };
    const prev = String(previousAssessmentId || '').trim();
    const assessmentId = prev && options.some((o) => o.id === prev) ? prev : options[0].id;
    return { assessmentId, options };
  }

  function formatMemberAnalysisDateLabel(isoDate) {
    if (!isoDate) return '—';
    const [y, m, d] = String(isoDate).split('-');
    if (!y || !m || !d) return isoDate;
    return `${y}.${m}.${d}`;
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

  function renderMemberSelectOptions(members, selectedId) {
    return members.map((m) =>
      `<option value="${escapeAttr(m.id)}"${m.id === selectedId ? ' selected' : ''}>${escapeHtml(m.name)}</option>`,
    ).join('');
  }

  function renderAssessmentSelectOptions(options, selectedId, formatDate) {
    const fmt = formatDate || formatMemberAnalysisDateLabel;
    return options.map((o) =>
      `<option value="${escapeAttr(o.id)}"${o.id === selectedId ? ' selected' : ''}>${escapeHtml(fmt(o.assessedAt))}</option>`,
    ).join('');
  }

  global.MemberAnalysisUiLogic = {
    isActiveMemberAnalysisMember,
    resolveStudentLabel,
    getMemberAnalysisStudentOptions,
    buildMemberSelectOptionsFromStudents,
    normalizeMemberAnalysisStudentsFromApi,
    resolveMemberSelectState,
    shouldFetchMemberAssessments,
    mapAssessmentRowToOption,
    resolveAssessmentSelectState,
    formatMemberAnalysisDateLabel,
    renderMemberSelectOptions,
    renderAssessmentSelectOptions,
  };
}(typeof window !== 'undefined' ? window : globalThis));
