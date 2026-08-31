/**
 * 2026 v3 定量アンケート — item_id 正本
 *
 * Item 定義の生成元 CSV: test/fixtures/member-analysis-v3-item-master.csv
 * 生成: npm run generate:member-analysis-v3-items
 *
 * v1 (member-analysis-2026-v1) とは独立。v1 ファイルは変更しない。
 */
import { MEMBER_ANALYSIS_QUESTIONNAIRE_V3_ITEMS } from './member-analysis-questionnaire-v3-items.js';

export const QUESTIONNAIRE_VERSION = 'member-analysis-2026-v3';
export const SCORING_VERSION = 'member-analysis-score-v3';

/** UI 互換 scores JSON 用 — internal dimension → output key */
export const V3_SCORE_OUTPUT_KEY_MAP = {
  bigFive: {
    extraversion: 'extraversion',
    conscientiousness: 'conscientiousness',
    agreeableness: 'agreeableness',
    negative_emotionality: 'emotionalStability',
    openness: 'openness',
  },
  schwartz: {
    self_direction: 'selfDirection',
    stimulation: 'stimulation',
    hedonism: 'hedonism',
    achievement: 'achievement',
    power: 'power',
    security: 'security',
    conformity: 'conformity',
    tradition: 'tradition',
    benevolence: 'benevolence',
    universalism: 'universalism',
  },
  riasec: {
    realistic: 'R',
    investigative: 'I',
    artistic: 'A',
    social: 'S',
    enterprising: 'E',
    conventional: 'C',
  },
  regulatoryFocus: {
    promotion: 'promotion',
    prevention: 'prevention',
  },
};

const INSTRUMENT_TO_SCALE = {
  lab_big5: 'bigFive',
  lab_values: 'schwartz',
  lab_regulatory_focus: 'regulatoryFocus',
  lab_riasec: 'riasec',
};

const SCALE_REVERSE_TRANSFORM = {
  bigFive: 'eight_minus',
};

const SCALE_DEFAULTS = {
  bigFive: { min: 1, max: 7 },
  schwartz: { min: 1, max: 6 },
  regulatoryFocus: { min: 1, max: 5 },
  riasec: { min: 1, max: 5 },
};

function buildScalesFromItems(items) {
  /** @type {Record<string, any>} */
  const scales = {};

  for (const item of items) {
    if (!item.scoringIncluded) continue;
    const scaleKey = INSTRUMENT_TO_SCALE[item.instrument];
    if (!scaleKey) continue;

    if (!scales[scaleKey]) {
      scales[scaleKey] = {
        label: scaleKey,
        ...SCALE_DEFAULTS[scaleKey],
        reverseTransform: SCALE_REVERSE_TRANSFORM[scaleKey] || null,
        traits: {},
      };
    }

    const traitKey = item.dimension;
    if (!scales[scaleKey].traits[traitKey]) {
      scales[scaleKey].traits[traitKey] = { items: [] };
    }
    scales[scaleKey].traits[traitKey].items.push({
      id: item.id,
      reverse: item.reverseScored,
    });
  }

  return scales;
}

export const MEMBER_ANALYSIS_QUESTIONNAIRE_V3 = {
  questionnaire_version: QUESTIONNAIRE_VERSION,
  scoring_version: SCORING_VERSION,
  items: MEMBER_ANALYSIS_QUESTIONNAIRE_V3_ITEMS,
  scales: buildScalesFromItems(MEMBER_ANALYSIS_QUESTIONNAIRE_V3_ITEMS),
  scoreOutputKeyMap: V3_SCORE_OUTPUT_KEY_MAP,
};

/** @returns {typeof MEMBER_ANALYSIS_QUESTIONNAIRE_V3_ITEMS} */
export function getAllV3ItemDefinitions() {
  return MEMBER_ANALYSIS_QUESTIONNAIRE_V3_ITEMS;
}

/** @param {string} itemId */
export function getV3ItemById(itemId) {
  return MEMBER_ANALYSIS_QUESTIONNAIRE_V3_ITEMS.find((i) => i.id === itemId) || null;
}

export function getV3ScoringItemCounts(config = MEMBER_ANALYSIS_QUESTIONNAIRE_V3) {
  const counts = {};
  for (const [scaleKey, scale] of Object.entries(config.scales || {})) {
    let total = 0;
    const byTrait = {};
    for (const [traitKey, trait] of Object.entries(scale.traits || {})) {
      const n = (trait.items || []).length;
      byTrait[traitKey] = n;
      total += n;
    }
    counts[scaleKey] = { total, byTrait };
  }
  return counts;
}

/**
 * negative_emotionality 平均 → UI 互換 emotionalStability
 * v1 emotionalStability は高いほど安定。v3 negative_emotionality は高いほど NE 高。
 * 7件法: emotionalStability = 8 - negative_emotionality（trait 平均に適用）
 */
export function convertNegativeEmotionalityToEmotionalStability(negMean) {
  if (negMean == null || !Number.isFinite(negMean)) return null;
  return Math.round((8 - negMean) * 10) / 10;
}

export function mapInternalScoresToUiScores(internalScores, config = MEMBER_ANALYSIS_QUESTIONNAIRE_V3) {
  const out = {};
  for (const [scaleKey, traitMap] of Object.entries(config.scoreOutputKeyMap || {})) {
    out[scaleKey] = {};
    const scaleScores = internalScores[scaleKey] || {};
    for (const [internalKey, uiKey] of Object.entries(traitMap)) {
      let value = scaleScores[internalKey] ?? null;
      if (scaleKey === 'bigFive' && internalKey === 'negative_emotionality') {
        value = convertNegativeEmotionalityToEmotionalStability(value);
      }
      out[scaleKey][uiKey] = value;
    }
  }
  return out;
}
