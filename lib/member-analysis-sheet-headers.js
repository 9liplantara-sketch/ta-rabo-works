/**
 * Google Form 回答 Sheet — header 分類・raw/hash フィルタ
 * GAS Code.gs は同仕様を mirror（import 不可のため定数を同期）
 */
import { createHash } from 'node:crypto';
import { normalizeHeaderKey } from './member-analysis-scoring.js';
import {
  MEMBER_ANALYSIS_QUESTIONNAIRE_V1,
  getScoringHeadersFromConfig,
} from './member-analysis-questionnaire-v1.js';

export const HEADER_CATEGORY = {
  EMPTY: 'empty',
  SCORING: 'scoring',
  META: 'meta',
  CONTEXTUAL: 'contextual',
  OBSOLETE_SCORING_EXCLUDED: 'obsolete_scoring_excluded',
  LEGACY_IGNORED: 'legacy_ignored',
  SYNC: 'sync',
  UNKNOWN: 'unknown',
};

function buildKnownSet(headers) {
  return new Set((headers || []).map(normalizeHeaderKey));
}

/** config から category → header の lookup を構築 */
export function buildHeaderCategoryLookup(config = MEMBER_ANALYSIS_QUESTIONNAIRE_V1) {
  const lookup = new Map();

  const add = (category, headers) => {
    for (const h of headers || []) {
      lookup.set(normalizeHeaderKey(h), category);
    }
  };

  add(HEADER_CATEGORY.SCORING, getScoringHeadersFromConfig(config));
  add(HEADER_CATEGORY.META, [
    ...(config.meta?.timestampHeaders || []),
    ...(config.meta?.nameHeaders || []),
    ...(config.meta?.emailHeaders || []),
  ]);
  add(HEADER_CATEGORY.CONTEXTUAL, config.contextualHeaders || []);
  add(HEADER_CATEGORY.OBSOLETE_SCORING_EXCLUDED, config.scoreExcludeHeaders || []);
  add(HEADER_CATEGORY.LEGACY_IGNORED, config.rawExcludeHeaders || []);
  add(HEADER_CATEGORY.SYNC, config.syncColumnHeaders || []);

  return lookup;
}

/** 単一 header の分類（trim 正規化） */
export function classifySheetHeader(header, config = MEMBER_ANALYSIS_QUESTIONNAIRE_V1) {
  const key = normalizeHeaderKey(header);
  if (!key) return HEADER_CATEGORY.EMPTY;
  return buildHeaderCategoryLookup(config).get(key) || HEADER_CATEGORY.UNKNOWN;
}

/**
 * Sheet 全 header を分類
 * @returns {{ byCategory: Record<string, string[]>, counts: Record<string, number>, unknown: string[] }}
 */
export function classifyAllSheetHeaders(sheetHeaders, config = MEMBER_ANALYSIS_QUESTIONNAIRE_V1) {
  const byCategory = {
    [HEADER_CATEGORY.SCORING]: [],
    [HEADER_CATEGORY.META]: [],
    [HEADER_CATEGORY.CONTEXTUAL]: [],
    [HEADER_CATEGORY.OBSOLETE_SCORING_EXCLUDED]: [],
    [HEADER_CATEGORY.LEGACY_IGNORED]: [],
    [HEADER_CATEGORY.SYNC]: [],
    [HEADER_CATEGORY.UNKNOWN]: [],
    [HEADER_CATEGORY.EMPTY]: [],
  };

  for (const h of sheetHeaders || []) {
    byCategory[classifySheetHeader(h, config)].push(h);
  }

  const counts = {};
  for (const [cat, list] of Object.entries(byCategory)) {
    counts[cat] = list.length;
  }

  return {
    byCategory,
    counts,
    unknown: byCategory[HEADER_CATEGORY.UNKNOWN],
  };
}

/** GAS hash / Neon raw_answers 用 — sync 列・legacy 列を除外 */
export function filterRawAnswersForSync(rawAnswers, config = MEMBER_ANALYSIS_QUESTIONNAIRE_V1) {
  const syncSet = buildKnownSet(config.syncColumnHeaders);
  const rawExcludeSet = buildKnownSet(config.rawExcludeHeaders);
  const out = {};

  for (const [key, value] of Object.entries(rawAnswers || {})) {
    const nk = normalizeHeaderKey(key);
    if (syncSet.has(nk) || rawExcludeSet.has(nk)) continue;
    out[key] = value;
  }
  return out;
}

/** canonical hash（キー sort + JSON + SHA-256）— GAS computeResponseHash_ と同じ */
export function computeResponseContentHash(responseMap) {
  const keys = Object.keys(responseMap).sort();
  const canonical = {};
  keys.forEach((k) => { canonical[k] = responseMap[k]; });
  const json = JSON.stringify(canonical);
  return createHash('sha256').update(json, 'utf8').digest('hex');
}
