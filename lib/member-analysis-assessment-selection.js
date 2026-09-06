/**
 * Phase 6A — AI / M3-L 向け psych assessment 選択（pure）
 *
 * 現行 semantic schema + current scorer を優先し、無い場合は
 * 既存の「最新1件」相当へ fallback（legacy 互換）。
 */

import { RESPONSE_SCHEMA_SEMANTIC_ITEMID_V3 } from './member-analysis-response-schema.js';
import {
  QUESTIONNAIRE_VERSION as CURRENT_QUESTIONNAIRE_VERSION,
  SCORING_VERSION as CURRENT_SCORING_VERSION,
} from './member-analysis-questionnaire-v3.js';

/** @returns {{ responseSchemaVersion: string, scoringVersion: string, questionnaireVersion: string }} */
export function getCurrentSemanticAssessmentCriteria() {
  return {
    responseSchemaVersion: RESPONSE_SCHEMA_SEMANTIC_ITEMID_V3,
    scoringVersion: CURRENT_SCORING_VERSION,
    questionnaireVersion: CURRENT_QUESTIONNAIRE_VERSION,
  };
}

/** @param {unknown} itemAnswers */
export function hasUsableItemAnswers(itemAnswers) {
  if (itemAnswers == null) return false;
  let obj = itemAnswers;
  if (typeof itemAnswers === 'string') {
    try {
      obj = JSON.parse(itemAnswers);
    } catch {
      return false;
    }
  }
  if (typeof obj !== 'object' || Array.isArray(obj)) return false;
  return Object.keys(obj).length > 0;
}

/**
 * @param {Record<string, unknown>} row
 * @param {ReturnType<typeof getCurrentSemanticAssessmentCriteria>} [criteria]
 */
export function isPreferredCurrentSemanticAssessment(row, criteria = getCurrentSemanticAssessmentCriteria()) {
  if (!row) return false;
  const schema = String(row.response_schema_version ?? row.responseSchemaVersion ?? '').trim();
  const scoring = String(row.scoring_version ?? row.scoringVersion ?? '').trim();
  const questionnaire = String(row.questionnaire_version ?? row.questionnaireVersion ?? '').trim();
  if (schema !== criteria.responseSchemaVersion) return false;
  if (scoring !== criteria.scoringVersion) return false;
  if (questionnaire !== criteria.questionnaireVersion) return false;
  return hasUsableItemAnswers(row.item_answers ?? row.itemAnswers);
}

function toMillis(value) {
  if (value == null || value === '') return 0;
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isNaN(t) ? 0 : t;
  }
  const t = new Date(String(value)).getTime();
  return Number.isNaN(t) ? 0 : t;
}

function academicYearNum(row) {
  const raw = row.academic_year ?? row.academicYear;
  const n = Number(raw);
  return Number.isFinite(n) ? n : Number.NEGATIVE_INFINITY;
}

/**
 * 決定的順序: academic_year DESC → answered_at DESC → created_at DESC → id DESC
 * @param {Record<string, unknown>} a
 * @param {Record<string, unknown>} b
 */
export function compareAssessmentsForAnalysis(a, b) {
  const ay = academicYearNum(b) - academicYearNum(a);
  if (ay !== 0) return ay;
  const answered = toMillis(b.answered_at ?? b.answeredAt) - toMillis(a.answered_at ?? a.answeredAt);
  if (answered !== 0) return answered;
  const created = toMillis(b.created_at ?? b.createdAt) - toMillis(a.created_at ?? a.createdAt);
  if (created !== 0) return created;
  return String(b.id || '').localeCompare(String(a.id || ''));
}

/**
 * @param {Record<string, unknown>[]} rows
 * @param {{ criteria?: ReturnType<typeof getCurrentSemanticAssessmentCriteria> }} [opts]
 * @returns {{ assessment: Record<string, unknown> | null, selection: 'current_semantic' | 'legacy_fallback' | 'none' }}
 */
export function selectPsychAssessmentForAnalysis(rows, opts = {}) {
  const list = Array.isArray(rows) ? rows.filter(Boolean) : [];
  if (!list.length) {
    return { assessment: null, selection: 'none' };
  }

  const criteria = opts.criteria || getCurrentSemanticAssessmentCriteria();
  const preferred = list.filter((row) => isPreferredCurrentSemanticAssessment(row, criteria));
  if (preferred.length) {
    const sorted = [...preferred].sort(compareAssessmentsForAnalysis);
    return { assessment: sorted[0], selection: 'current_semantic' };
  }

  const sortedAll = [...list].sort(compareAssessmentsForAnalysis);
  return { assessment: sortedAll[0], selection: 'legacy_fallback' };
}
