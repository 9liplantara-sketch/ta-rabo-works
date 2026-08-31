/**
 * 2026 v3 採点 — item_id キー（raw_answers / Sheet header は使用しない）
 *
 * v1 scorer (member-analysis-scoring.js) とは独立。v1 コード・挙動は変更しない。
 */
import {
  MEMBER_ANALYSIS_QUESTIONNAIRE_V3,
  SCORING_VERSION,
  mapInternalScoresToUiScores,
} from './member-analysis-questionnaire-v3.js';

export const EXPECTED_V3_SCORING_ITEM_COUNT = 74;

/** v1 と同じ表示精度: 小数1桁・Math.round */
function round1(n) {
  return Math.round(n * 10) / 10;
}

/**
 * @param {unknown} raw
 * @param {number} min
 * @param {number} max
 * @returns {{ ok: true, value: number } | { ok: false, reason: string }}
 */
export function parseV3ScoringItemValue(raw, min, max) {
  if (raw === undefined || raw === null) {
    return { ok: false, reason: 'null/undefined' };
  }
  if (typeof raw === 'string') {
    if (raw.trim() === '') return { ok: false, reason: 'blank' };
    if (/^\s+$/.test(raw)) return { ok: false, reason: 'whitespace' };
  }
  const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isFinite(n)) {
    return { ok: false, reason: 'non-numeric' };
  }
  if (n < min || n > max) {
    return { ok: false, reason: 'out-of-range' };
  }
  return { ok: true, value: n };
}

/**
 * @param {import('./member-analysis-questionnaire-v3.js').MEMBER_ANALYSIS_QUESTIONNAIRE_V3} questionnaire
 * @returns {string[]}
 */
export function getV3ScoringItemIds(questionnaire = MEMBER_ANALYSIS_QUESTIONNAIRE_V3) {
  const ids = [];
  for (const scale of Object.values(questionnaire.scales || {})) {
    for (const trait of Object.values(scale.traits || {})) {
      for (const item of trait.items || []) {
        if (item?.id) ids.push(item.id);
      }
    }
  }
  return ids;
}

function applyItemReverse(value, scale, item) {
  if (!item.reverse) return value;
  if (scale.reverseTransform === 'eight_minus') return 8 - value;
  return scale.max + scale.min - value;
}

function averageRounded(values) {
  if (!values.length) return null;
  return round1(values.reduce((a, b) => a + b, 0) / values.length);
}

/**
 * @param {Record<string, unknown>} itemAnswers — 恒久 item_id → 回答
 * @param {typeof MEMBER_ANALYSIS_QUESTIONNAIRE_V3} [questionnaire]
 * @returns {{ ok: true, questionnaire_version: string, scoring_version: string, scores: object } | { ok: false, error: string }}
 */
export function scoreMemberAssessmentV3(itemAnswers, questionnaire = MEMBER_ANALYSIS_QUESTIONNAIRE_V3) {
  if (!itemAnswers || typeof itemAnswers !== 'object' || Array.isArray(itemAnswers)) {
    return { ok: false, error: 'item_answers must be an object for v3 scoring' };
  }

  const scoringItemIds = getV3ScoringItemIds(questionnaire);
  if (scoringItemIds.length !== EXPECTED_V3_SCORING_ITEM_COUNT) {
    return {
      ok: false,
      error: `v3 scoring definition item count: expected ${EXPECTED_V3_SCORING_ITEM_COUNT}, got ${scoringItemIds.length}`,
    };
  }

  /** @type {Record<string, Record<string, number|null>>} */
  const internalScores = {};

  for (const [scaleKey, scale] of Object.entries(questionnaire.scales || {})) {
    internalScores[scaleKey] = {};
    for (const [traitKey, traitConfig] of Object.entries(scale.traits || {})) {
      const expectedItems = traitConfig.items || [];
      const transformed = [];

      for (const item of expectedItems) {
        if (!Object.prototype.hasOwnProperty.call(itemAnswers, item.id)) {
          return { ok: false, error: `missing scoring item: ${item.id}` };
        }
        const parsed = parseV3ScoringItemValue(itemAnswers[item.id], scale.min, scale.max);
        if (!parsed.ok) {
          return { ok: false, error: `invalid scoring item ${item.id}: ${parsed.reason}` };
        }
        transformed.push(applyItemReverse(parsed.value, scale, item));
      }

      if (transformed.length !== expectedItems.length) {
        return { ok: false, error: `partial scoring for ${scaleKey}.${traitKey}` };
      }

      internalScores[scaleKey][traitKey] = averageRounded(transformed);
    }
  }

  const scores = mapInternalScoresToUiScores(internalScores, questionnaire);

  return {
    ok: true,
    questionnaire_version: questionnaire.questionnaire_version,
    scoring_version: SCORING_VERSION,
    scores,
  };
}
