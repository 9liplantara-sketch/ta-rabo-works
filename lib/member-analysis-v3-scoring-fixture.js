/**
 * GAS payload 相当 — 全 scoring item を Form Grid 列ラベル文字列で構築（verify 用）
 */
import { MEMBER_ANALYSIS_QUESTIONNAIRE_V3 } from './member-analysis-questionnaire-v3.js';
import { listV3FormScaleLabels } from './member-analysis-v3-form-scale-choices.js';

/** instrument → 中間点の canonical label（Form getColumns() 実測文字列） */
const MIDPOINT_LABEL_BY_INSTRUMENT = {
  lab_big5: '4：どちらともいえない',
  lab_values: '4：少し似ている',
  lab_regulatory_focus: '3：どちらともいえない',
  lab_riasec: '3. どちらともいえない',
};

/**
 * 118 keys: scoring 74 = string labels, non-scoring = ''（GAS raw semantic 模擬）
 * @returns {Record<string, string>}
 */
export function buildGasEquivalentV3ItemAnswers() {
  /** @type {Record<string, string>} */
  const answers = {};
  for (const item of MEMBER_ANALYSIS_QUESTIONNAIRE_V3.items) {
    if (!item.scoringIncluded) {
      answers[item.id] = '';
      continue;
    }
    const label = MIDPOINT_LABEL_BY_INSTRUMENT[item.instrument];
    if (!label) {
      throw new Error(`no midpoint label for instrument ${item.instrument}`);
    }
    const labels = listV3FormScaleLabels(item.instrument);
    if (!labels.includes(label)) {
      throw new Error(`midpoint label missing from map: ${item.instrument} ${label}`);
    }
    answers[item.id] = label;
  }
  return answers;
}

/**
 * 74 scoring items のみ — 全て string（GAS Grid 回答型）
 * @returns {Record<string, string>}
 */
export function buildGasEquivalentV3ScoringStringsOnly() {
  const full = buildGasEquivalentV3ItemAnswers();
  /** @type {Record<string, string>} */
  const scoring = {};
  for (const item of MEMBER_ANALYSIS_QUESTIONNAIRE_V3.items) {
    if (item.scoringIncluded) scoring[item.id] = full[item.id];
  }
  return scoring;
}
