/**
 * Phase 6E — admin-only read-only qualitative analysis source preflight
 *
 * Uses the same source selection as analysis (fetchAnalysisContextForStudent).
 * Never enqueues runs or writes profile / consent / psych rows.
 * Response is counts + safe metadata only (no bodies / scores / item_answers / PII).
 */

import { assertQualitativeAdmin } from './member-qualitative-access.js';
import {
  assertConsentStudentExistsOrThrow,
  assertConsentRecordsTableReadyAsync,
  getConsentStatusForStudent,
  LOCAL_AI_ANALYSIS_PURPOSE,
  LOCAL_AI_ANALYSIS_POLICY_VERSION,
} from './member-local-ai-consent.js';
import { parseAnalysisWindow } from './member-qualitative-sources.js';
import { fetchAnalysisContextForStudent } from './member-qualitative-worker.js';
import { parseIntakeEvidenceSourceId, INTAKE_SOURCE_KIND } from './member-qualitative-intake-sources.js';
import { assertQualitativeTablesReadyAsync } from './member-qualitative-profile.js';

/**
 * Mechanical isolation checks on selected source objects (no body inspection).
 * @param {string} studentId
 * @param {Array<Record<string, unknown>>} sources
 * @param {{ selectedAssessmentId?: string | null }} [opts]
 */
export function computeAnalysisSourceIsolation(studentId, sources, opts = {}) {
  const sid = String(studentId || '').trim();
  const selectedAssessmentId = opts.selectedAssessmentId
    ? String(opts.selectedAssessmentId).trim()
    : null;

  let privateDailyIncluded = 0;
  let crossStudentDaily = 0;
  let crossStudentKnowledge = 0;
  let crossStudentIntake = 0;

  for (const s of sources || []) {
    const kind = String(s?.sourceKind || s?.source_kind || '');
    if (kind === 'daily_report') {
      if (String(s.visibility || '') === 'private') {
        privateDailyIncluded += 1;
      }
      const owners = (s.participants || [])
        .map((p) => String(p?.studentId || p?.student_id || '').trim())
        .filter(Boolean);
      // Analysis daily sources are single-owner; must be exactly the target student.
      if (owners.length !== 1 || owners[0] !== sid) {
        crossStudentDaily += 1;
      }
      continue;
    }

    if (kind === 'knowledge_record') {
      const participants = (s.participants || [])
        .map((p) => String(p?.studentId || p?.student_id || '').trim())
        .filter(Boolean);
      if (!participants.includes(sid)) {
        crossStudentKnowledge += 1;
      }
      continue;
    }

    if (kind === INTAKE_SOURCE_KIND || kind === 'intake_response') {
      const parsed = parseIntakeEvidenceSourceId(s.sourceId || s.source_id);
      if (!parsed?.assessmentId) {
        crossStudentIntake += 1;
        continue;
      }
      if (selectedAssessmentId && parsed.assessmentId !== selectedAssessmentId) {
        crossStudentIntake += 1;
      }
    }
  }

  return {
    private_daily_included: privateDailyIncluded,
    cross_student_daily: crossStudentDaily,
    cross_student_knowledge: crossStudentKnowledge,
    cross_student_intake: crossStudentIntake,
  };
}

/**
 * Build safe preflight JSON from an already-fetched analysis context (+ consent).
 * Pure / testable — does not touch DB.
 */
export function buildQualitativePreflightPayload({
  studentId,
  consentStatus,
  context,
  window,
}) {
  const sid = String(studentId || '').trim();
  const decision = consentStatus?.decision || {};
  const active = consentStatus?.active || null;
  const psych = context?.psych || null;
  const selection = context?.assessmentSelection || null;
  const sources = context?.sources || [];
  const selectedAssessmentId = psych?.id ? String(psych.id) : null;

  const isolation = computeAnalysisSourceIsolation(sid, sources, { selectedAssessmentId });

  const sourceCount = Number(context?.sourceCount ?? sources.length) || 0;
  const consentPermitted = decision.permitted === true;
  const isolationClean =
    isolation.private_daily_included === 0
    && isolation.cross_student_daily === 0
    && isolation.cross_student_knowledge === 0
    && isolation.cross_student_intake === 0;

  return {
    ok: true,
    student_id: sid,
    window: {
      from_date: window?.fromDate || null,
      to_date: window?.toDate || null,
    },
    consent: {
      permitted: consentPermitted,
      reason: decision.reason || null,
      policy_version: active
        ? String(active.policy_version || active.policyVersion || '')
        : null,
      required_policy_version: LOCAL_AI_ANALYSIS_POLICY_VERSION,
    },
    sources: {
      psych_assessment: {
        exists: !!psych,
        questionnaire_version: psych
          ? String(psych.questionnaire_version || psych.questionnaireVersion || '')
          : null,
        scoring_version: psych
          ? String(psych.scoring_version || psych.scoringVersion || '')
          : null,
        response_schema_version: psych
          ? String(psych.response_schema_version || psych.responseSchemaVersion || '') || null
          : null,
        selection: selection || null,
      },
      intake: {
        assessment_exists: !!psych,
        semantic_v3: selection === 'current_semantic',
        ai_eligible_count: Number(context?.intakeResponseCount || 0),
      },
      daily: {
        shareable_count: Number(context?.dailyReportCount || 0),
      },
      knowledge: {
        count: Number(context?.knowledgeRecordCount || 0),
      },
      confirmed_profile: {
        count: Array.isArray(context?.confirmed) ? context.confirmed.length : 0,
      },
    },
    isolation,
    source_count: sourceCount,
    ready: consentPermitted && sourceCount > 0 && isolationClean,
  };
}

/**
 * Admin-only read-only preflight using production analysis source selection.
 * @param {object} user
 * @param {string} studentId
 * @param {object} [windowInput]
 */
export async function runQualitativeAnalysisPreflight(user, studentId, windowInput = {}) {
  assertQualitativeAdmin(user);
  await assertConsentStudentExistsOrThrow(studentId);
  await assertQualitativeTablesReadyAsync();
  await assertConsentRecordsTableReadyAsync();

  const sid = String(studentId).trim();
  const consentStatus = await getConsentStatusForStudent(sid, LOCAL_AI_ANALYSIS_PURPOSE);
  const window = parseAnalysisWindow(windowInput || {});
  const context = await fetchAnalysisContextForStudent(sid, window);

  return buildQualitativePreflightPayload({
    studentId: sid,
    consentStatus,
    context,
    window,
  });
}
