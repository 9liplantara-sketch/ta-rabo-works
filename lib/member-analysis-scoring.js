import { MEMBER_ANALYSIS_QUESTIONNAIRE_V1 } from './member-analysis-questionnaire-v1.js';

/**
 * @typedef {{ header: string, reverse?: boolean }} QuestionItem
 * @typedef {{ items: QuestionItem[] }} TraitConfig
 * @typedef {{
 *   label: string,
 *   min: number,
 *   max: number,
 *   reverseTransform?: string|null,
 *   traits: Record<string, TraitConfig>
 * }} ScaleConfig
 * @typedef {{
 *   questionnaire_version: string,
 *   scoring_version: string,
 *   excludeHeaders?: string[],
 *   scales: Record<string, ScaleConfig>
 * }} QuestionnaireConfig
 */

function round1(n) {
  return Math.round(n * 10) / 10;
}

/** Sheet header / config header 比較用（前後空白 trim） */
export function normalizeHeaderKey(header) {
  return String(header ?? '').trim();
}

/** raw_answers を trim キー lookup に変換（元キーは保持しない） */
export function buildAnswerLookup(rawAnswers) {
  const lookup = new Map();
  if (!rawAnswers || typeof rawAnswers !== 'object') return lookup;
  for (const [key, value] of Object.entries(rawAnswers)) {
    lookup.set(normalizeHeaderKey(key), value);
  }
  return lookup;
}

export function lookupRawAnswer(lookup, configHeader) {
  return lookup.get(normalizeHeaderKey(configHeader));
}

export function getAllScoringHeaders(questionnaire) {
  const headers = [];
  for (const scale of Object.values(questionnaire?.scales || {})) {
    for (const trait of Object.values(scale.traits || {})) {
      for (const item of trait.items || []) {
        if (item?.header) headers.push(item.header);
      }
    }
  }
  return headers;
}

export function parseNumericAnswer(raw, min, max) {
  if (raw === undefined || raw === null || raw === '') return null;
  const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isFinite(n)) return null;
  if (n < min || n > max) return null;
  return n;
}

export function applyReverseTransform(value, scale, item) {
  if (!item.reverse) return value;
  if (scale.reverseTransform === 'eight_minus') return 8 - value;
  return scale.max + scale.min - value;
}

export function averageValues(values) {
  if (!values.length) return null;
  const sum = values.reduce((a, b) => a + b, 0);
  return round1(sum / values.length);
}

export function scoreTrait(answerLookup, scale, traitKey, traitConfig, warnings) {
  const values = [];
  for (const item of traitConfig.items || []) {
    const raw = lookupRawAnswer(answerLookup, item.header);
    const parsed = parseNumericAnswer(raw, scale.min, scale.max);
    if (parsed === null) {
      warnings.push(`${scale.label} ${traitKey}: invalid or missing "${item.header}"`);
      continue;
    }
    values.push(applyReverseTransform(parsed, scale, item));
  }
  if (!values.length) {
    warnings.push(`${scale.label} ${traitKey}: no scorable answers`);
    return null;
  }
  if (values.length < (traitConfig.items || []).length) {
    warnings.push(`${scale.label} ${traitKey}: partial answers (${values.length}/${traitConfig.items.length})`);
  }
  return averageValues(values);
}

export function scoreScale(answerLookup, scaleKey, scale, warnings) {
  const out = {};
  for (const [traitKey, traitConfig] of Object.entries(scale.traits || {})) {
    out[traitKey] = scoreTrait(answerLookup, scale, traitKey, traitConfig, warnings);
  }
  return out;
}

/**
 * @param {Record<string, unknown>} rawAnswers
 * @param {QuestionnaireConfig} [questionnaire]
 */
export function scoreMemberAssessment(rawAnswers, questionnaire = MEMBER_ANALYSIS_QUESTIONNAIRE_V1) {
  const warnings = [];
  const scores = {};
  const answerLookup = buildAnswerLookup(rawAnswers);

  for (const [scaleKey, scale] of Object.entries(questionnaire.scales || {})) {
    scores[scaleKey] = scoreScale(answerLookup, scaleKey, scale, warnings);
  }

  return {
    questionnaire_version: questionnaire.questionnaire_version,
    scoring_version: questionnaire.scoring_version,
    scores,
    warnings,
  };
}

/** テスト用の最小 questionnaire（本番 Sheet とは無関係） */
export function buildTestQuestionnaireV1() {
  return {
    questionnaire_version: 'test-v1',
    scoring_version: 'test-score-v1',
    scales: {
      bigFive: {
        label: 'BIG FIVE',
        min: 1,
        max: 7,
        reverseTransform: 'eight_minus',
        traits: {
          extraversion: {
            items: [
              { header: 'BF_E1', reverse: false },
              { header: 'BF_E2', reverse: true },
            ],
          },
          conscientiousness: { items: [{ header: 'BF_C1', reverse: false }] },
          agreeableness: { items: [{ header: 'BF_A1', reverse: false }] },
          emotionalStability: { items: [{ header: 'BF_N1', reverse: true }] },
          openness: { items: [{ header: 'BF_O1', reverse: false }] },
        },
      },
      riasec: {
        label: 'RIASEC',
        min: 1,
        max: 5,
        reverseTransform: null,
        traits: {
          R: { items: [{ header: 'RIASEC_R1', reverse: false }] },
          I: { items: [{ header: 'RIASEC_I1', reverse: false }] },
          A: { items: [{ header: 'RIASEC_A1', reverse: false }] },
          S: { items: [{ header: 'RIASEC_S1', reverse: false }] },
          E: { items: [{ header: 'RIASEC_E1', reverse: false }] },
          C: { items: [{ header: 'RIASEC_C1', reverse: false }] },
        },
      },
      schwartz: {
        label: 'SCHWARTZ 10',
        min: 1,
        max: 6,
        reverseTransform: null,
        traits: {
          selfDirection: { items: [{ header: 'SV_SD1', reverse: false }, { header: 'SV_SD2', reverse: false }] },
          stimulation: { items: [{ header: 'SV_ST1', reverse: false }, { header: 'SV_ST2', reverse: false }] },
          hedonism: { items: [{ header: 'SV_HE1', reverse: false }, { header: 'SV_HE2', reverse: false }] },
          achievement: { items: [{ header: 'SV_AC1', reverse: false }, { header: 'SV_AC2', reverse: false }] },
          power: { items: [{ header: 'SV_PO1', reverse: false }, { header: 'SV_PO2', reverse: false }] },
          security: { items: [{ header: 'SV_SE1', reverse: false }, { header: 'SV_SE2', reverse: false }] },
          conformity: { items: [{ header: 'SV_CO1', reverse: false }, { header: 'SV_CO2', reverse: false }] },
          tradition: { items: [{ header: 'SV_TR1', reverse: false }, { header: 'SV_TR2', reverse: false }] },
          benevolence: { items: [{ header: 'SV_BE1', reverse: false }, { header: 'SV_BE2', reverse: false }] },
          universalism: { items: [{ header: 'SV_UN1', reverse: false }, { header: 'SV_UN2', reverse: false }] },
        },
      },
      regulatoryFocus: {
        label: '制御焦点',
        min: 1,
        max: 7,
        reverseTransform: null,
        traits: {
          promotion: { items: [{ header: 'RF_P1', reverse: false }, { header: 'RF_P2', reverse: false }] },
          prevention: { items: [{ header: 'RF_V1', reverse: false }, { header: 'RF_V2', reverse: false }] },
        },
      },
    },
  };
}
