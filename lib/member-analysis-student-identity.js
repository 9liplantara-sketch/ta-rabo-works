/**
 * Phase 5D — student identity matching（純粋ロジック）
 *
 * canonical person = students.id
 * annual response = (source, source_response_id)
 *
 * ADM-02 学籍番号は自動 match しない。
 */

export const STUDENT_MATCH_METHODS = Object.freeze({
  EMAIL: 'email',
  NAME: 'name',
  UNMATCHED_EMAIL: 'unmatched_email',
  UNMATCHED_NAME: 'unmatched_name',
  AMBIGUOUS_EMAIL: 'ambiguous_email',
  AMBIGUOUS_NAME: 'ambiguous_name',
});

/** Sheet / Form email header 候補（GAS META_HEADERS.email と同期） */
export const EMAIL_HEADER_CANDIDATES = Object.freeze(['メールアドレス', 'Email Address']);

/** Sheet name header 候補（GAS META_HEADERS.name と同期） */
export const NAME_HEADER_CANDIDATES = Object.freeze(['Q1. 氏名（必須）', '氏名', 'お名前', '名前']);

/** 学籍番号 Sheet header（item master ADM-02 description） */
export const STUDENT_NUMBER_HEADER_CANDIDATES = Object.freeze(['学籍番号']);

export function normalizePersonName(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/\s+/g, '')
    .trim();
}

/**
 * @param {unknown} raw
 * @returns {string | null} trim+lowercase。blank は null
 */
export function normalizeEmail(raw) {
  if (raw === undefined || raw === null) return null;
  const trimmed = String(raw).trim().toLowerCase();
  return trimmed || null;
}

/**
 * match_method が student_id=null の失敗系か
 * @param {string} matchMethod
 */
export function isUnlinkedStudentMatchMethod(matchMethod) {
  const m = String(matchMethod || '');
  return (
    m === STUDENT_MATCH_METHODS.UNMATCHED_EMAIL
    || m === STUDENT_MATCH_METHODS.UNMATCHED_NAME
    || m === STUDENT_MATCH_METHODS.AMBIGUOUS_EMAIL
    || m === STUDENT_MATCH_METHODS.AMBIGUOUS_NAME
    || m === 'unmatched' // legacy
  );
}

/**
 * email がある場合は name へ fallback しない。
 * @param {{
 *   respondentEmail?: string | null,
 *   respondentName?: string | null,
 *   students?: Array<{ id: string, name?: string, display_name?: string, email?: string | null }>,
 * }} input
 * @returns {{ studentId: string | null, matchMethod: string }}
 */
export function classifyStudentMatch(input) {
  const students = input.students || [];
  const email = normalizeEmail(input.respondentEmail);

  if (email) {
    const emailHits = [];
    for (const s of students) {
      if (normalizeEmail(s.email) === email) emailHits.push(s);
    }
    if (emailHits.length === 1) {
      return { studentId: emailHits[0].id, matchMethod: STUDENT_MATCH_METHODS.EMAIL };
    }
    if (emailHits.length > 1) {
      return { studentId: null, matchMethod: STUDENT_MATCH_METHODS.AMBIGUOUS_EMAIL };
    }
    // email が回答に存在するのに 0 件 → 氏名へ誤リンクしない
    return { studentId: null, matchMethod: STUDENT_MATCH_METHODS.UNMATCHED_EMAIL };
  }

  const normalized = normalizePersonName(input.respondentName);
  if (!normalized) {
    return { studentId: null, matchMethod: STUDENT_MATCH_METHODS.UNMATCHED_NAME };
  }

  const matchedIds = new Set();
  for (const s of students) {
    if (normalizePersonName(s.name) === normalized) matchedIds.add(s.id);
    if (s.display_name && normalizePersonName(s.display_name) === normalized) matchedIds.add(s.id);
  }

  if (matchedIds.size === 1) {
    return { studentId: [...matchedIds][0], matchMethod: STUDENT_MATCH_METHODS.NAME };
  }
  if (matchedIds.size > 1) {
    return { studentId: null, matchMethod: STUDENT_MATCH_METHODS.AMBIGUOUS_NAME };
  }
  return { studentId: null, matchMethod: STUDENT_MATCH_METHODS.UNMATCHED_NAME };
}

/**
 * Form collectsEmail と Sheet email 列検出の整合。
 * @param {{
 *   formCollectsEmail?: boolean | null,
 *   emailColumnDetected?: boolean,
 *   emailPopulatedRows?: number,
 *   responseRows?: number,
 * }} input
 */
export function evaluateStudentIdentityInputs(input) {
  const warnings = [];
  const errors = [];
  const formCollects = input.formCollectsEmail;
  const detected = !!input.emailColumnDetected;
  const populated = Number(input.emailPopulatedRows || 0);
  const rows = Number(input.responseRows || 0);

  if (formCollects === true && !detected) {
    errors.push('form_collects_email_but_sheet_email_column_not_detected');
  }

  if (formCollects === false && !detected) {
    warnings.push('Form does not collect email; name matching only (Phase 5D)');
  }

  if (detected && rows > 0 && populated === 0) {
    warnings.push('email column detected but all response emails are empty');
  }

  if (formCollects === true && detected && rows > 0 && populated < rows) {
    warnings.push(`email populated rows ${populated} / ${rows}`);
  }

  if (errors.length) {
    return {
      validation: 'FAIL',
      reason: errors[0],
      warnings,
      errors,
    };
  }

  return {
    validation: 'PASS',
    reason: null,
    warnings,
    errors,
  };
}

/**
 * headerMap（header → col）から候補ヘッダーを検出。
 * @param {Record<string, unknown>} headerMap
 * @param {readonly string[]} candidates
 * @returns {string | null}
 */
export function detectHeaderFromCandidates(headerMap, candidates) {
  const map = headerMap || {};
  for (const h of candidates) {
    if (Object.prototype.hasOwnProperty.call(map, h)) return h;
  }
  return null;
}

/**
 * @param {unknown} value
 */
export function isNonEmptyIdentityValue(value) {
  if (value === null || value === undefined) return false;
  return String(value).trim() !== '';
}
