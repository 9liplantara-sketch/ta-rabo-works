/**
 * Phase 5C — 年度確定 read-only audit
 *
 * GAS Form/Sheet/hash 監査と Neon SQL checklist を分離する。
 * finalized_at / annual_cycles はまだ作らない。
 */
import { EXPECTED_V3_MAPPING_ACTIVE_COUNT, evaluateAnnualFormLifecycle } from './member-analysis-form-lifecycle.js';
import { V3_SCORE_OUTPUT_KEY_MAP } from './member-analysis-questionnaire-v3.js';

export const FINALIZATION_VALIDATION = {
  READY: 'READY',
  NOT_READY: 'NOT_READY',
  FAIL: 'FAIL',
};

export const V3_SCORE_BLOCKS = Object.freeze(Object.keys(V3_SCORE_OUTPUT_KEY_MAP));

export const EXPECTED_V3_ITEM_ANSWERS_KEY_COUNT = EXPECTED_V3_MAPPING_ACTIVE_COUNT;

/**
 * @param {unknown} scores
 * @returns {{ ok: boolean, missingBlocks: string[] }}
 */
export function evaluateV3ScoresCompleteness(scores) {
  if (!scores || typeof scores !== 'object' || Array.isArray(scores)) {
    return { ok: false, missingBlocks: [...V3_SCORE_BLOCKS] };
  }
  const missingBlocks = V3_SCORE_BLOCKS.filter((key) => {
    const block = scores[key];
    return !block || typeof block !== 'object' || Array.isArray(block) || Object.keys(block).length === 0;
  });
  return { ok: missingBlocks.length === 0, missingBlocks };
}

/**
 * Neon SQL 結果の解釈（GAS からは呼ばない）。
 * unmatched > 0 は WARN。同一 student_id × year の重複は NOT_READY。
 * @param {{
 *   total?: number,
 *   scored?: number,
 *   itemAnswers118?: number,
 *   unmatched?: number,
 *   duplicateStudentRows?: number,
 * }} input
 */
export function evaluateNeonFinalizationSnapshot(input) {
  const warnings = [];
  const errors = [];
  const total = Number(input.total || 0);
  const scored = Number(input.scored || 0);
  const itemAnswers118 = Number(input.itemAnswers118 || 0);
  const unmatched = Number(input.unmatched || 0);
  const duplicateStudentRows = Number(input.duplicateStudentRows || 0);

  if (scored !== total) {
    errors.push(`scoring incomplete: scored ${scored} / ${total}`);
  }
  if (itemAnswers118 !== total) {
    errors.push(`item_answers incomplete: ${itemAnswers118} / ${total} have 118 keys`);
  }
  if (unmatched > 0) {
    warnings.push(
      `unmatched_student: ${unmatched} (analysis UI excludes student_id=null; linkage is Phase 5D)`,
    );
  }
  if (duplicateStudentRows > 0) {
    errors.push(`duplicate student_id × academic_year: ${duplicateStudentRows}`);
  }

  if (errors.length) {
    return {
      ready: false,
      validation: FINALIZATION_VALIDATION.NOT_READY,
      reason: duplicateStudentRows > 0 ? 'duplicate_student_year' : 'neon_snapshot_incomplete',
      warnings,
      errors,
    };
  }

  return {
    ready: true,
    validation: FINALIZATION_VALIDATION.READY,
    reason: null,
    warnings,
    errors,
  };
}

function mappingOk(mapping) {
  const active = mapping?.activeCount;
  const itemIds = mapping?.itemIdCount ?? mapping?.activeCount;
  const unresolved = mapping?.unresolvedCount ?? 0;
  const duplicates = mapping?.duplicateCount ?? 0;
  return (
    active === EXPECTED_V3_MAPPING_ACTIVE_COUNT
    && itemIds === EXPECTED_V3_MAPPING_ACTIVE_COUNT
    && unresolved === 0
    && duplicates === 0
  );
}

function sheetOk(sheet) {
  const responseRows = Number(sheet?.responseRows || 0);
  const synced = Number(sheet?.synced || 0);
  const error = Number(sheet?.error || 0);
  const pending = Number(sheet?.pending || 0);
  return error === 0 && pending === 0 && synced === responseRows;
}

function hashOk(hash) {
  return (
    Number(hash?.legacyMismatch || 0) === 0
    && Number(hash?.missing || 0) === 0
    && Number(hash?.wouldSync || 0) === 0
  );
}

/**
 * @param {{
 *   collectionState: string | null,
 *   collectionStateOk: boolean,
 *   collectionStateError?: string | null,
 *   academicYearValid: boolean,
 *   formIdValid?: boolean,
 *   form?: {
 *     acceptingResponses?: boolean | null,
 *     limitOneResponsePerUser?: boolean | null,
 *     allowResponseEdits?: boolean | null,
 *     collectsEmail?: boolean | null,
 *   },
 *   mapping?: {
 *     activeCount?: number | null,
 *     itemIdCount?: number | null,
 *     unresolvedCount?: number,
 *     duplicateCount?: number,
 *   },
 *   sheet?: {
 *     responseRows?: number,
 *     synced?: number,
 *     error?: number,
 *     pending?: number,
 *   },
 *   hash?: {
 *     stable?: number,
 *     legacyCompatible?: number,
 *     legacyMismatch?: number,
 *     missing?: number,
 *     wouldSync?: number,
 *   },
 *   syncEnabled?: boolean,
 * }} input
 */
export function evaluateAnnualFinalization(input) {
  const warnings = [];
  const errors = [];
  const form = input.form || {};
  const mapping = input.mapping || {};
  const sheet = input.sheet || {};
  const hash = input.hash || {};

  if (!input.collectionStateOk || !input.collectionState) {
    return {
      ready: false,
      validation: FINALIZATION_VALIDATION.FAIL,
      reason: input.collectionStateError || 'MEMBER_ANALYSIS_COLLECTION_STATE is not configured',
      warnings,
      errors: [input.collectionStateError || 'MEMBER_ANALYSIS_COLLECTION_STATE is not configured'],
    };
  }

  if (input.collectionState === 'open') {
    return {
      ready: false,
      validation: FINALIZATION_VALIDATION.NOT_READY,
      reason: 'collection_still_open',
      warnings,
      errors: ['collection_still_open'],
    };
  }

  if (input.collectionState === 'preparing') {
    return {
      ready: false,
      validation: FINALIZATION_VALIDATION.NOT_READY,
      reason: 'collection_not_opened_or_closed',
      warnings,
      errors: ['collection_not_opened_or_closed'],
    };
  }

  if (input.collectionState !== 'closed') {
    return {
      ready: false,
      validation: FINALIZATION_VALIDATION.FAIL,
      reason: `unsupported collection_state: ${input.collectionState}`,
      warnings,
      errors: [`unsupported collection_state: ${input.collectionState}`],
    };
  }

  const lifecycle = evaluateAnnualFormLifecycle({
    collectionState: 'closed',
    collectionStateOk: true,
    academicYearValid: input.academicYearValid,
    formIdValid: input.formIdValid,
    mappingActiveCount: mapping.activeCount ?? null,
    acceptingResponses: form.acceptingResponses,
    limitOneResponsePerUser: form.limitOneResponsePerUser,
    allowResponseEdits: form.allowResponseEdits,
    collectsEmail: form.collectsEmail,
    syncEnabled: input.syncEnabled,
  });

  warnings.push(...(lifecycle.warnings || []));
  for (const info of lifecycle.info || []) {
    if (info.startsWith('allow response edits: true')) {
      warnings.push('response editing setting remains enabled');
    }
  }

  if (!input.academicYearValid) {
    errors.push('academic_year invalid or missing');
  }
  if (form.acceptingResponses !== false) {
    errors.push('accepting responses must be false');
  }
  if (!mappingOk(mapping)) {
    errors.push(
      `mapping invalid: active=${mapping.activeCount ?? 'null'} item_id=${mapping.itemIdCount ?? mapping.activeCount ?? 'null'} unresolved=${mapping.unresolvedCount ?? 0} duplicates=${mapping.duplicateCount ?? 0}`,
    );
  }
  if (!sheetOk(sheet)) {
    errors.push(
      `sheet sync incomplete: rows=${sheet.responseRows ?? 0} synced=${sheet.synced ?? 0} error=${sheet.error ?? 0} pending=${sheet.pending ?? 0}`,
    );
  }
  if (!hashOk(hash)) {
    errors.push(
      `hash not clean: mismatch=${hash.legacyMismatch ?? 0} missing=${hash.missing ?? 0} would_sync=${hash.wouldSync ?? 0}`,
    );
  }

  if (lifecycle.validation !== 'PASS') {
    for (const e of lifecycle.errors || []) {
      if (!errors.includes(e)) errors.push(e);
    }
  }

  if (errors.length) {
    let reason = errors[0];
    if (form.acceptingResponses !== false) reason = 'accepting_responses_still_true';
    else if (!sheetOk(sheet)) reason = 'sheet_sync_incomplete';
    else if (!hashOk(hash)) reason = 'hash_not_clean';
    else if (!mappingOk(mapping)) reason = 'mapping_invalid';
    else if (!input.academicYearValid) reason = 'academic_year_invalid';

    return {
      ready: false,
      validation: FINALIZATION_VALIDATION.NOT_READY,
      reason,
      warnings,
      errors,
    };
  }

  return {
    ready: true,
    validation: FINALIZATION_VALIDATION.READY,
    reason: null,
    warnings,
    errors,
  };
}
