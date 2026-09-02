/**
 * Phase 5A — academic_year metadata（collection cycle）
 *
 * questionnaire_version（定義世代）とは独立。
 * stable hash には含めない。
 */

export const ACADEMIC_YEAR_MIN = 2000;
export const ACADEMIC_YEAR_MAX = 2100;

/** migration backfill 対象 questionnaire_version */
export const MEMBER_ANALYSIS_ACADEMIC_YEAR_BACKFILL_VERSIONS = [
  'member-analysis-2026-v1',
  'member-analysis-2026-v3',
];

export const MEMBER_ANALYSIS_ACADEMIC_YEAR_BACKFILL_VALUE = 2026;

/**
 * strict number の academic_year を検証。
 * @param {unknown} raw
 * @returns {{ ok: true, value: number } | { ok: false, error: string }}
 */
export function parseAcademicYear(raw) {
  if (raw === undefined || raw === null || raw === '') {
    return { ok: false, error: 'academic_year is required' };
  }
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return { ok: false, error: 'academic_year must be a finite number' };
  }
  if (!Number.isInteger(raw)) {
    return { ok: false, error: 'academic_year must be an integer' };
  }
  if (raw < ACADEMIC_YEAR_MIN || raw > ACADEMIC_YEAR_MAX) {
    return {
      ok: false,
      error: `academic_year out of range (${ACADEMIC_YEAR_MIN}–${ACADEMIC_YEAR_MAX})`,
    };
  }
  return { ok: true, value: raw };
}

/**
 * sync payload 用 — v3 は required、v1/legacy は optional。
 * @param {unknown} raw
 * @param {{ required?: boolean }} [opts]
 */
export function validateAcademicYearForSync(raw, opts = {}) {
  const required = !!opts.required;
  if (raw === undefined || raw === null || raw === '') {
    if (required) {
      return { ok: false, error: 'academic_year is required for v3' };
    }
    return { ok: true, value: null };
  }
  return parseAcademicYear(raw);
}

/**
 * upsert 前の academic_year 不変チェック。
 * existing NULL → incoming で補完可。一致 → UPDATE 可。不一致 → fail closed。
 * @param {number|null|undefined} existingYear
 * @param {number|null|undefined} incomingYear
 */
export function assertAcademicYearUpsertAllowed(existingYear, incomingYear) {
  if (existingYear == null) {
    return { ok: true };
  }
  if (incomingYear == null) {
    return { ok: true };
  }
  const existing = Number(existingYear);
  const incoming = Number(incomingYear);
  if (existing === incoming) {
    return { ok: true };
  }
  return {
    ok: false,
    error: `academic_year mismatch: existing ${existing}, incoming ${incoming}`,
  };
}
