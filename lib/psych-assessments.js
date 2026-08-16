import { getDb, findStudentByEmail, listStudents } from './db.js';
import { scoreMemberAssessment } from './member-analysis-scoring.js';
import {
  MEMBER_ANALYSIS_QUESTIONNAIRE_V1,
  isQuestionnaireMappingReady,
} from './member-analysis-questionnaire-v1.js';
import { filterRawAnswersForSync } from './member-analysis-sheet-headers.js';

export const PSYCH_SOURCE_GOOGLE_FORMS_SHEET = 'google_forms_sheet';

export function normalizePersonName(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/\s+/g, '')
    .trim();
}

export function parseAnsweredAt(raw) {
  if (!raw) return null;
  const d = raw instanceof Date ? raw : new Date(String(raw));
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export function mapPsychAssessmentForClient(row) {
  if (!row) return null;
  return {
    id: row.id,
    student_id: row.student_id,
    respondent_name: row.respondent_name,
    answered_at: row.answered_at,
    scores: typeof row.scores === 'object' && row.scores ? row.scores : {},
    questionnaire_version: row.questionnaire_version,
    scoring_version: row.scoring_version,
  };
}

/**
 * 名前 normalized 完全一致（email 解決後 · テスト/同期共用）
 * fuzzy / 部分一致 / 自動作成は行わない
 */
export function resolveStudentMatchFromList({ respondentEmail, respondentName, students }) {
  const email = String(respondentEmail || '').trim().toLowerCase();
  if (email) {
    const byEmail = (students || []).find(
      (s) => String(s.email || '').trim().toLowerCase() === email,
    );
    if (byEmail) return { studentId: byEmail.id, matchMethod: 'email' };
  }

  const normalized = normalizePersonName(respondentName);
  if (!normalized) return { studentId: null, matchMethod: 'unmatched' };

  const matchedIds = new Set();
  for (const s of students || []) {
    if (normalizePersonName(s.name) === normalized) matchedIds.add(s.id);
    if (s.display_name && normalizePersonName(s.display_name) === normalized) matchedIds.add(s.id);
  }

  if (matchedIds.size === 1) {
    return { studentId: [...matchedIds][0], matchMethod: 'name' };
  }
  if (matchedIds.size > 1) {
    return { studentId: null, matchMethod: 'ambiguous_name' };
  }
  return { studentId: null, matchMethod: 'unmatched' };
}

/**
 * M2 本番: 現 Sheet に email 列なし → respondent_email=null → normalized name 完全一致。
 * 将来 Form でメール収集を有効化した場合は email 完全一致を優先。
 */
export async function matchStudentForAssessment({ respondentEmail, respondentName }) {
  const email = String(respondentEmail || '').trim().toLowerCase();
  if (email) {
    const byEmail = await findStudentByEmail(email);
    if (byEmail) return { studentId: byEmail.id, matchMethod: 'email' };
  }

  const students = await listStudents({ activeOnly: false });
  return resolveStudentMatchFromList({ respondentEmail, respondentName, students });
}

export async function listPsychAssessments({ studentId } = {}) {
  const sql = getDb();
  if (studentId) {
    const rows = await sql`
      SELECT id, student_id, respondent_name, respondent_email, answered_at,
             source, source_response_id, questionnaire_version, scoring_version,
             scores, created_at, updated_at
      FROM psych_assessments
      WHERE student_id = ${studentId}
      ORDER BY answered_at DESC, created_at DESC
    `;
    return rows.map(mapPsychAssessmentForClient);
  }

  const rows = await sql`
    SELECT id, student_id, respondent_name, respondent_email, answered_at,
           source, source_response_id, questionnaire_version, scoring_version,
           scores, created_at, updated_at
    FROM psych_assessments
    ORDER BY answered_at DESC, created_at DESC
  `;
  return rows.map(mapPsychAssessmentForClient);
}

export async function upsertPsychAssessmentFromSync({
  source,
  sourceResponseId,
  answeredAt,
  respondentName,
  respondentEmail,
  rawAnswers,
  questionnaireVersion,
  scoringVersion,
  scores,
  studentId,
}) {
  const sql = getDb();
  const rows = await sql`
    INSERT INTO psych_assessments (
      student_id,
      respondent_name,
      respondent_email,
      answered_at,
      source,
      source_response_id,
      questionnaire_version,
      scoring_version,
      raw_answers,
      scores
    ) VALUES (
      ${studentId},
      ${respondentName || null},
      ${respondentEmail || null},
      ${answeredAt},
      ${source},
      ${sourceResponseId},
      ${questionnaireVersion},
      ${scoringVersion},
      ${JSON.stringify(rawAnswers || {})}::jsonb,
      ${JSON.stringify(scores || {})}::jsonb
    )
    ON CONFLICT (source, source_response_id) DO UPDATE SET
      student_id = EXCLUDED.student_id,
      respondent_name = EXCLUDED.respondent_name,
      respondent_email = EXCLUDED.respondent_email,
      answered_at = EXCLUDED.answered_at,
      questionnaire_version = EXCLUDED.questionnaire_version,
      scoring_version = EXCLUDED.scoring_version,
      raw_answers = EXCLUDED.raw_answers,
      scores = EXCLUDED.scores,
      updated_at = NOW()
    RETURNING id, student_id
  `;
  return rows[0];
}

function validateSyncResponse(item) {
  const sourceResponseId = String(item?.source_response_id || '').trim();
  if (!sourceResponseId) return { ok: false, error: 'source_response_id is required' };

  const answeredAt = parseAnsweredAt(item?.answered_at);
  if (!answeredAt) return { ok: false, error: 'answered_at is invalid' };

  const rawAnswers = item?.raw_answers;
  if (!rawAnswers || typeof rawAnswers !== 'object' || Array.isArray(rawAnswers)) {
    return { ok: false, error: 'raw_answers must be an object' };
  }

  const filteredRaw = filterRawAnswersForSync(rawAnswers);

  return {
    ok: true,
    value: {
      sourceResponseId,
      answeredAt,
      respondentName: item.respondent_name ? String(item.respondent_name).trim() : null,
      respondentEmail: item.respondent_email ? String(item.respondent_email).trim().toLowerCase() : null,
      rawAnswers: filteredRaw,
    },
  };
}

/** @internal tests — batch 部分成功の validation 確認用 */
export function validateSyncResponseForTest(item) {
  return validateSyncResponse(item);
}

export async function syncPsychAssessmentBatch({
  source = PSYCH_SOURCE_GOOGLE_FORMS_SHEET,
  questionnaireVersion,
  responses = [],
}) {
  if (!isQuestionnaireMappingReady()) {
    return {
      ok: false,
      error: 'Questionnaire header mapping is not configured. Run sheet audit and update lib/member-analysis-questionnaire-v1.js',
      received: responses.length,
      synced: 0,
      skipped: 0,
      failed: responses.length,
      results: [],
    };
  }

  const qVersion = questionnaireVersion || MEMBER_ANALYSIS_QUESTIONNAIRE_V1.questionnaire_version;
  const results = [];
  let synced = 0;
  let skipped = 0;
  let failed = 0;

  for (const item of responses) {
    const validated = validateSyncResponse(item);
    if (!validated.ok) {
      failed += 1;
      results.push({
        source_response_id: item?.source_response_id || null,
        status: 'failed',
        error: validated.error,
      });
      continue;
    }

    const { sourceResponseId, answeredAt, respondentName, respondentEmail, rawAnswers } = validated.value;

    try {
      const scored = scoreMemberAssessment(rawAnswers, MEMBER_ANALYSIS_QUESTIONNAIRE_V1);
      const { studentId, matchMethod } = await matchStudentForAssessment({
        respondentEmail,
        respondentName,
      });

      const row = await upsertPsychAssessmentFromSync({
        source,
        sourceResponseId,
        answeredAt,
        respondentName,
        respondentEmail,
        rawAnswers,
        questionnaireVersion: qVersion,
        scoringVersion: scored.scoring_version,
        scores: scored.scores,
        studentId,
      });

      synced += 1;
      results.push({
        source_response_id: sourceResponseId,
        status: matchMethod === 'unmatched' || matchMethod === 'ambiguous_name'
          ? 'unmatched_student'
          : 'synced',
        student_id: studentId,
        assessment_id: row?.id || null,
        match_method: matchMethod,
        warnings: scored.warnings?.length ? scored.warnings : undefined,
      });
    } catch (e) {
      failed += 1;
      results.push({
        source_response_id: sourceResponseId,
        status: 'failed',
        error: e.message || 'sync failed',
      });
    }
  }

  return {
    ok: failed === 0,
    received: responses.length,
    synced,
    skipped,
    failed,
    results,
  };
}
