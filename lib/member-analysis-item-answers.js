/**
 * Phase 2 — raw_answers（Sheet ヘッダー）→ item_answers（恒久 item_id）
 *
 * Mapping の source_header / row_label から回答 Sheet 列を構造的に解決する。
 * 質問文の意味的 fuzzy match は行わない。
 */

export const QUESTIONNAIRE_VERSION_V1 = 'member-analysis-2026-v1';
export const QUESTIONNAIRE_VERSION_V3 = 'member-analysis-2026-v3';
export const SCORING_VERSION_V3_DEFERRED = 'member-analysis-score-v3-deferred';

export const EXPECTED_V3_ACTIVE_ITEM_COUNT = 118;

/**
 * @param {Array<{ google_item_id?: string, row_index?: string|number, row_label?: string, source_header?: string, item_id?: string, active?: string }>} mappingRows
 */
export function filterActiveMappedRows(mappingRows) {
  return (mappingRows || []).filter((row) => {
    if (String(row.active || '').toUpperCase() === 'FALSE') return false;
    const itemId = String(row.item_id || '').trim();
    return itemId && itemId !== 'UNMAPPED';
  });
}

/**
 * @param {ReturnType<typeof filterActiveMappedRows>} activeRows
 */
export function auditActiveMappingForItemAnswers(activeRows) {
  const errors = [];
  if (activeRows.length !== EXPECTED_V3_ACTIVE_ITEM_COUNT) {
    errors.push(`active mapped rows: expected ${EXPECTED_V3_ACTIVE_ITEM_COUNT}, got ${activeRows.length}`);
  }

  const itemIds = activeRows.map((r) => String(r.item_id || '').trim());
  const unique = new Set(itemIds);
  if (unique.size !== itemIds.length) {
    errors.push('duplicate item_id in active mapping');
  }
  if (itemIds.some((id) => !id || id === 'UNMAPPED')) {
    errors.push('UNMAPPED or empty item_id in active mapping');
  }

  const keyCounts = new Map();
  for (const row of activeRows) {
    const key = `${row.google_item_id}\u0001${row.row_index ?? ''}`;
    keyCounts.set(key, (keyCounts.get(key) || 0) + 1);
  }
  for (const [key, n] of keyCounts) {
    if (n > 1) errors.push(`duplicate google_item_id+row_index: ${key}`);
  }

  return { ok: errors.length === 0, errors, activeCount: activeRows.length, uniqueItemIds: unique.size };
}

/** @param {string} text */
function firstLine(text) {
  return String(text || '').split(/\r?\n/)[0].trim();
}

/** @param {string} text */
function collapseWhitespace(text) {
  return String(text || '').replace(/[\u3000\s]+/g, ' ').trim();
}

/**
 * 回答 Sheet 列名の候補（構造的バリアントのみ。意味推測なし）。
 * @param {{ row_index?: string|number, row_label?: string, source_header?: string }} row
 * @returns {string[]}
 */
export function candidateAnswerHeadersForMappingRow(row) {
  const sourceHeader = String(row.source_header || '').trim();
  const rowLabel = String(row.row_label || '').trim();
  const rowIndex = row.row_index === null || row.row_index === undefined || row.row_index === ''
    ? ''
    : String(row.row_index);

  const titles = [];
  const pushTitle = (t) => {
    const v = String(t || '').trim();
    if (v && !titles.includes(v)) titles.push(v);
  };

  pushTitle(sourceHeader);
  pushTitle(collapseWhitespace(sourceHeader));
  pushTitle(firstLine(sourceHeader));
  pushTitle(collapseWhitespace(firstLine(sourceHeader)));

  if (rowIndex === '') {
    return titles;
  }

  const candidates = [];
  for (const title of titles) {
    const bracketed = `${title} [${rowLabel}]`;
    if (!candidates.includes(bracketed)) candidates.push(bracketed);
  }
  // Forms が row_label のみ列名にするケースは通常ないが、一意キーとして明示候補にはしない
  return candidates;
}

/**
 * @param {Record<string, unknown>} rawAnswers
 * @param {string[]} candidates
 * @returns {string|null} matched header key
 */
export function resolveRawAnswerHeader(rawAnswers, candidates) {
  const keys = Object.keys(rawAnswers || {});
  for (const candidate of candidates) {
    if (Object.prototype.hasOwnProperty.call(rawAnswers, candidate)) return candidate;
  }
  // whitespace-collapsed exact match against existing keys
  const collapsedMap = new Map();
  for (const key of keys) {
    collapsedMap.set(collapseWhitespace(key), key);
  }
  for (const candidate of candidates) {
    const hit = collapsedMap.get(collapseWhitespace(candidate));
    if (hit) return hit;
  }
  return null;
}

/**
 * @param {Record<string, unknown>} rawAnswers
 * @param {Array<object>} mappingRows — Mapping Sheet 全行 or active 行
 */
export function buildItemAnswersFromMapping(rawAnswers, mappingRows) {
  const activeRows = filterActiveMappedRows(mappingRows);
  const audit = auditActiveMappingForItemAnswers(activeRows);
  if (!audit.ok) {
    return {
      ok: false,
      errors: audit.errors,
      itemAnswers: null,
      unresolvedItemIds: [],
      resolvedCount: 0,
    };
  }

  /** @type {Record<string, unknown>} */
  const itemAnswers = {};
  const unresolvedItemIds = [];
  const usedHeaders = new Set();

  for (const row of activeRows) {
    const itemId = String(row.item_id).trim();
    const candidates = candidateAnswerHeadersForMappingRow(row);
    const header = resolveRawAnswerHeader(rawAnswers, candidates);
    if (!header) {
      unresolvedItemIds.push(itemId);
      continue;
    }
    usedHeaders.add(header);
    itemAnswers[itemId] = rawAnswers[header];
  }

  const errors = [];
  if (unresolvedItemIds.length) {
    errors.push(`unresolved item_id count: ${unresolvedItemIds.length}`);
  }
  const answerIds = Object.keys(itemAnswers);
  if (new Set(answerIds).size !== answerIds.length) {
    errors.push('duplicate item_id in item_answers');
  }
  if (answerIds.length !== EXPECTED_V3_ACTIVE_ITEM_COUNT && unresolvedItemIds.length === 0) {
    errors.push(`item_answers count: expected ${EXPECTED_V3_ACTIVE_ITEM_COUNT}, got ${answerIds.length}`);
  }

  return {
    ok: errors.length === 0,
    errors,
    itemAnswers: errors.length ? null : itemAnswers,
    unresolvedItemIds,
    resolvedCount: answerIds.length,
    usedHeaderCount: usedHeaders.size,
  };
}

/**
 * API validation helper — optional for v1, required object for v3.
 * @param {unknown} itemAnswers
 * @param {{ required?: boolean }} [opts]
 */
export function validateItemAnswersField(itemAnswers, opts = {}) {
  const required = !!opts.required;
  if (itemAnswers === undefined || itemAnswers === null) {
    if (required) return { ok: false, error: 'item_answers is required for v3' };
    return { ok: true, value: null };
  }
  if (typeof itemAnswers !== 'object' || Array.isArray(itemAnswers)) {
    return { ok: false, error: 'item_answers must be an object' };
  }

  const keys = Object.keys(itemAnswers);
  if (required && keys.length !== EXPECTED_V3_ACTIVE_ITEM_COUNT) {
    return {
      ok: false,
      error: `item_answers must have ${EXPECTED_V3_ACTIVE_ITEM_COUNT} keys (got ${keys.length})`,
    };
  }
  if (keys.some((k) => !String(k).trim())) {
    return { ok: false, error: 'item_answers contains empty key' };
  }
  return { ok: true, value: itemAnswers };
}

export function isV3QuestionnaireVersion(version) {
  return String(version || '').trim() === QUESTIONNAIRE_VERSION_V3;
}
