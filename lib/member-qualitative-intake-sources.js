/**
 * Phase 6A — Form intake (semantic v3 item_answers) → AI source builder
 *
 * 正本: psych_assessments.item_answers + questionnaire item master (stable item_id)
 * client API へ item_answers を露出しない。server-side AI 用のみ。
 */

import { MEMBER_ANALYSIS_QUESTIONNAIRE_V3_ITEMS } from './member-analysis-questionnaire-v3-items.js';
import { QUESTIONNAIRE_VERSION as CURRENT_QUESTIONNAIRE_VERSION } from './member-analysis-questionnaire-v3.js';

export const INTAKE_SOURCE_KIND = 'intake_response';
export const INTAKE_EPISTEMIC_TYPE = 'self_report';

const FREE_TEXT_RESPONSE_TYPES = new Set(['text', 'paragraph']);

/** @param {unknown} itemAnswers */
export function normalizeItemAnswersObject(itemAnswers) {
  if (itemAnswers == null) return null;
  if (typeof itemAnswers === 'string') {
    try {
      return normalizeItemAnswersObject(JSON.parse(itemAnswers));
    } catch {
      return null;
    }
  }
  if (typeof itemAnswers !== 'object' || Array.isArray(itemAnswers)) return null;
  return itemAnswers;
}

/** @param {unknown} raw */
export function isNonEmptyAnswerText(raw) {
  if (raw == null) return false;
  if (typeof raw === 'string') return raw.trim().length > 0;
  if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw).trim().length > 0;
  return false;
}

/**
 * AI へ渡す自由記述候補か（尺度 raw / non-aiEligible / checkbox 等は除外）
 * @param {(typeof MEMBER_ANALYSIS_QUESTIONNAIRE_V3_ITEMS)[number]} def
 */
export function isAiIntakeTextItem(def) {
  if (!def || def.aiEligible !== true) return false;
  if (def.scoringIncluded === true) return false;
  const responseType = String(def.responseType || '').trim();
  return FREE_TEXT_RESPONSE_TYPES.has(responseType);
}

/**
 * 安定 evidence id（assessment 正本への参照。本文は複製しない）
 * @param {string} assessmentId
 * @param {string} itemId
 */
export function buildIntakeSourceId(assessmentId, itemId) {
  return `${String(assessmentId).trim()}:${String(itemId).trim()}`;
}

/**
 * @param {string} sourceId
 * @returns {{ assessmentId: string, itemId: string } | null}
 */
export function parseIntakeSourceId(sourceId) {
  const raw = String(sourceId || '').trim();
  const idx = raw.indexOf(':');
  if (idx <= 0 || idx === raw.length - 1) return null;
  const assessmentId = raw.slice(0, idx).trim();
  const itemId = raw.slice(idx + 1).trim();
  if (!assessmentId || !itemId) return null;
  return { assessmentId, itemId };
}

/**
 * @param {{
 *   assessmentId: string,
 *   itemAnswers: unknown,
 *   answeredAt?: string | Date | null,
 *   questionnaireVersion?: string | null,
 *   itemMaster?: typeof MEMBER_ANALYSIS_QUESTIONNAIRE_V3_ITEMS,
 * }} input
 */
export function buildIntakeSourcesFromItemAnswers(input) {
  const assessmentId = String(input?.assessmentId || '').trim();
  const answers = normalizeItemAnswersObject(input?.itemAnswers);
  const skipped = [];
  const sources = [];

  if (!assessmentId) {
    return { sources, skipped: [{ itemId: '', reason: 'missing_assessment_id' }], intakeResponseCount: 0 };
  }
  if (!answers) {
    return { sources, skipped: [{ itemId: '', reason: 'missing_item_answers' }], intakeResponseCount: 0 };
  }

  const masterList = Array.isArray(input.itemMaster)
    ? input.itemMaster
    : MEMBER_ANALYSIS_QUESTIONNAIRE_V3_ITEMS;
  const byId = new Map(masterList.map((item) => [String(item.id), item]));

  const occurredAt = input.answeredAt
    ? (input.answeredAt instanceof Date
      ? input.answeredAt.toISOString()
      : String(input.answeredAt))
    : null;

  for (const [rawItemId, rawValue] of Object.entries(answers)) {
    const itemId = String(rawItemId || '').trim();
    if (!itemId) {
      skipped.push({ itemId: '', reason: 'empty_item_id' });
      continue;
    }

    const def = byId.get(itemId);
    if (!def) {
      skipped.push({ itemId, reason: 'unknown_item_id' });
      continue;
    }
    if (!isAiIntakeTextItem(def)) {
      skipped.push({
        itemId,
        reason: def.aiEligible !== true
          ? 'not_ai_eligible'
          : (def.scoringIncluded ? 'scoring_raw_excluded' : 'non_text_response'),
      });
      continue;
    }
    if (!isNonEmptyAnswerText(rawValue)) {
      skipped.push({ itemId, reason: 'empty_answer' });
      continue;
    }

    const question = String(def.description || '').trim();
    const text = typeof rawValue === 'string' ? rawValue.trim() : String(rawValue).trim();

    sources.push({
      sourceKind: INTAKE_SOURCE_KIND,
      sourceId: buildIntakeSourceId(assessmentId, itemId),
      sourceType: INTAKE_SOURCE_KIND,
      title: question || itemId,
      occurredAt,
      bodyText: text,
      visibility: 'lab',
      updatedAt: occurredAt,
      createdAt: occurredAt,
      itemId,
      question,
      questionVersion: def.questionVersion || null,
      scope: def.scope || null,
      epistemicType: INTAKE_EPISTEMIC_TYPE,
      questionnaireVersion: input.questionnaireVersion || CURRENT_QUESTIONNAIRE_VERSION,
    });
  }

  return {
    sources,
    skipped,
    intakeResponseCount: sources.length,
  };
}

export function summarizeV3IntakeAiEligibility(itemMaster = MEMBER_ANALYSIS_QUESTIONNAIRE_V3_ITEMS) {
  const items = itemMaster || [];
  const scoringIncluded = items.filter((i) => i.scoringIncluded === true).length;
  const aiEligible = items.filter((i) => i.aiEligible === true).length;
  const aiInputTextItems = items.filter((i) => isAiIntakeTextItem(i)).length;
  return {
    total: items.length,
    scoringIncluded,
    nonScoring: items.length - scoringIncluded,
    aiEligible,
    aiInputTextItems,
  };
}
