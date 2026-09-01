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
import { getV3FormScaleLabelMap } from './member-analysis-v3-form-scale-choices.js';

export const EXPECTED_V3_SCORING_ITEM_COUNT = 74;

/** v1 と同じ表示精度: 小数1桁・Math.round */
function round1(n) {
  return Math.round(n * 10) / 10;
}

/**
 * 文字列全体が有限整数であることを厳密検証（parseInt / 部分一致禁止）。
 * @param {string} text — trim 済み
 * @returns {number | null}
 */
export function parseStrictIntegerString(text) {
  if (!/^-?\d+$/.test(text)) return null;
  const n = Number(text);
  if (!Number.isSafeInteger(n)) return null;
  return n;
}

/**
 * scorer 内部 — raw Form/Sheet 回答 → integer scale value。
 * @param {unknown} raw
 * @param {{ min: number, max: number, instrument?: string }} itemDefinition
 * @returns {{ ok: true, value: number } | { ok: false, reason: string }}
 */
export function normalizeScoringValueV3(raw, itemDefinition) {
  const { min, max, instrument = '' } = itemDefinition;

  if (raw === undefined || raw === null) {
    return { ok: false, reason: 'null/undefined' };
  }

  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed === '') return { ok: false, reason: 'blank' };
    if (/^\s+$/.test(raw)) return { ok: false, reason: 'whitespace' };

    const fromDigits = parseStrictIntegerString(trimmed);
    if (fromDigits !== null) {
      if (fromDigits < min || fromDigits > max) {
        return { ok: false, reason: 'out-of-range' };
      }
      return { ok: true, value: fromDigits };
    }

    const labelMap = instrument ? getV3FormScaleLabelMap(instrument) : null;
    if (labelMap?.has(trimmed)) {
      const value = labelMap.get(trimmed);
      if (value < min || value > max) {
        return { ok: false, reason: 'out-of-range' };
      }
      return { ok: true, value };
    }

    return { ok: false, reason: 'unsupported numeric representation' };
  }

  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) {
      return { ok: false, reason: 'unsupported numeric representation' };
    }
    if (!Number.isInteger(raw)) {
      return { ok: false, reason: 'non-integer' };
    }
    if (raw < min || raw > max) {
      return { ok: false, reason: 'out-of-range' };
    }
    return { ok: true, value: raw };
  }

  return { ok: false, reason: 'unsupported numeric representation' };
}

/**
 * @param {unknown} raw
 * @param {number} min
 * @param {number} max
 * @param {string} [instrument]
 * @returns {{ ok: true, value: number } | { ok: false, reason: string }}
 */
export function parseV3ScoringItemValue(raw, min, max, instrument = '') {
  return normalizeScoringValueV3(raw, { min, max, instrument });
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

const SCALE_TO_INSTRUMENT = {
  bigFive: 'lab_big5',
  schwartz: 'lab_values',
  regulatoryFocus: 'lab_regulatory_focus',
  riasec: 'lab_riasec',
};

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
        const parsed = normalizeScoringValueV3(itemAnswers[item.id], {
          min: scale.min,
          max: scale.max,
          instrument: SCALE_TO_INSTRUMENT[scaleKey] || '',
        });
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
