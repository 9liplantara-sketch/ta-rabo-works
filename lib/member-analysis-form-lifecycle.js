/**
 * Phase 5B — 年度 Form lifecycle（業務状態）
 *
 * MEMBER_ANALYSIS_COLLECTION_STATE は Form 運用 metadata。
 * sync payload / DB / stable hash には含めない。
 */

export const COLLECTION_STATE_PROPERTY = 'MEMBER_ANALYSIS_COLLECTION_STATE';

export const COLLECTION_STATES = ['preparing', 'open', 'closed'];

export const EXPECTED_V3_MAPPING_ACTIVE_COUNT = 118;

/** @typedef {'preparing'|'open'|'closed'} CollectionState */

/**
 * @param {unknown} raw
 * @returns {{ ok: true, value: CollectionState } | { ok: false, error: string, display: string }}
 */
export function parseCollectionState(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return {
      ok: false,
      error: `${COLLECTION_STATE_PROPERTY} is not configured`,
      display: 'MISSING',
    };
  }

  const trimmed = String(raw).trim();
  if (trimmed !== trimmed.toLowerCase()) {
    return {
      ok: false,
      error: `collection_state must be lowercase: ${COLLECTION_STATES.join('|')}`,
      display: trimmed,
    };
  }

  if (!COLLECTION_STATES.includes(trimmed)) {
    return {
      ok: false,
      error: `unsupported collection_state: ${trimmed}`,
      display: trimmed,
    };
  }

  return { ok: true, value: /** @type {CollectionState} */ (trimmed) };
}

/**
 * @param {boolean|null|undefined} value
 * @param {string} label
 */
function formatBool(value, label) {
  if (value === null || value === undefined) return `${label}: (unknown)`;
  return `${label}: ${value ? 'true' : 'false'}`;
}

/**
 * @param {{
 *   collectionState: CollectionState | null,
 *   collectionStateOk: boolean,
 *   collectionStateError?: string | null,
 *   academicYearValid: boolean,
 *   formIdValid?: boolean,
 *   mappingActiveCount: number | null,
 *   acceptingResponses: boolean | null,
 *   limitOneResponsePerUser: boolean | null,
 *   allowResponseEdits: boolean | null,
 *   collectsEmail?: boolean | null,
 *   syncEnabled?: boolean,
 * }} input
 * @returns {{
 *   validation: 'PASS' | 'FAIL',
 *   reason: string | null,
 *   warnings: string[],
 *   info: string[],
 *   errors: string[],
 * }}
 */
export function evaluateAnnualFormLifecycle(input) {
  const warnings = [];
  const info = [];
  const errors = [];

  if (!input.collectionStateOk || !input.collectionState) {
    errors.push(input.collectionStateError || `${COLLECTION_STATE_PROPERTY} is not configured`);
    return {
      validation: 'FAIL',
      reason: errors[0],
      warnings,
      info,
      errors,
    };
  }

  if (!input.academicYearValid) {
    errors.push('academic_year invalid or missing');
  }

  if (input.formIdValid === false) {
    errors.push('MEMBER_ANALYSIS_FORM_ID invalid or missing');
  }

  if (input.mappingActiveCount !== EXPECTED_V3_MAPPING_ACTIVE_COUNT) {
    errors.push(
      `mapping active count: expected ${EXPECTED_V3_MAPPING_ACTIVE_COUNT}, got ${input.mappingActiveCount ?? 'null'}`,
    );
  }

  const state = input.collectionState;

  if (state === 'preparing') {
    if (input.acceptingResponses === true) {
      warnings.push('preparing: accepting responses is true (recommended: false)');
    }
    if (input.syncEnabled === true) {
      warnings.push('preparing: sync enabled is true (recommended: false)');
    }
  }

  if (state === 'open') {
    if (input.acceptingResponses !== true) {
      errors.push('accepting responses must be true');
    }
    if (input.limitOneResponsePerUser !== true) {
      return failLifecycle('multiple_new_responses_allowed', errors, warnings, info, [
        'limit one response per user must be true',
      ]);
    }
    if (input.allowResponseEdits !== true) {
      return failLifecycle('response_editing_disabled', errors, warnings, info, [
        'allow response edits must be true',
      ]);
    }
    if (input.syncEnabled === false) {
      warnings.push('collection is open but sync is disabled');
    }
  }

  if (state === 'closed') {
    if (input.acceptingResponses !== false) {
      errors.push('accepting responses must be false');
    }
    if (input.allowResponseEdits === true) {
      info.push('allow response edits: true (Form API; edit URL behavior may vary after close)');
    } else if (input.allowResponseEdits === false) {
      info.push('allow response edits: false');
    }
  }

  if (input.collectsEmail === false) {
    info.push('email collection: OFF');
    info.push('identity matching improvement: pending Phase 5D');
  } else if (input.collectsEmail === true) {
    info.push('email collection: ON');
  }

  if (errors.length) {
    return {
      validation: 'FAIL',
      reason: errors[0],
      warnings,
      info,
      errors,
    };
  }

  return {
    validation: 'PASS',
    reason: null,
    warnings,
    info,
    errors,
  };
}

/**
 * @param {string} reason
 * @param {string[]} errors
 * @param {string[]} warnings
 * @param {string[]} info
 * @param {string[]} extraErrors
 */
function failLifecycle(reason, errors, warnings, info, extraErrors) {
  for (const e of extraErrors) {
    if (!errors.includes(e)) errors.push(e);
  }
  return {
    validation: 'FAIL',
    reason,
    warnings,
    info,
    errors,
  };
}

/**
 * GAS summary 用 — boolean を文字列化
 * @param {boolean|null|undefined} value
 */
export function formatLifecycleBool(value) {
  if (value === null || value === undefined) return '—';
  return value ? 'true' : 'false';
}
