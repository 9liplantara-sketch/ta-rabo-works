import { getDb, listStudents } from './db.js';
import { scoreMemberAssessment } from './member-analysis-scoring.js';
import { scoreMemberAssessmentV3 } from './member-analysis-scoring-v3.js';
import {
  MEMBER_ANALYSIS_QUESTIONNAIRE_V1,
  isQuestionnaireMappingReady,
} from './member-analysis-questionnaire-v1.js';
import { filterRawAnswersForSync } from './member-analysis-sheet-headers.js';
import {
  isV3QuestionnaireVersion,
  QUESTIONNAIRE_VERSION_V1,
  validateItemAnswersField,
} from './member-analysis-item-answers.js';
import {
  assertAcademicYearUpsertAllowed,
  validateAcademicYearForSync,
} from './member-analysis-academic-year.js';
import {
  classifyStudentMatch,
  isUnlinkedStudentMatchMethod,
  normalizePersonName,
} from './member-analysis-student-identity.js';
import {
  RESPONSE_SCHEMA_LEGACY_PHYSICAL_V1,
  RESPONSE_SCHEMA_SEMANTIC_ITEMID_V3,
  assertResponseSchemaUpsertAllowed,
  assertSourceLayoutUpsertAllowed,
  describeAssessmentDataMode,
  validateSemanticV3SchemaFields,
} from './member-analysis-response-schema.js';

export const PSYCH_SOURCE_GOOGLE_FORMS_SHEET = 'google_forms_sheet';

export { normalizePersonName };

export function parseAnsweredAt(raw) {
  if (!raw) return null;
  const d = raw instanceof Date ? raw : new Date(String(raw));
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export function mapPsychAssessmentForClient(row) {
  if (!row) return null;
  const mode = describeAssessmentDataMode(row);
  return {
    id: row.id,
    student_id: row.student_id,
    respondent_name: row.respondent_name,
    answered_at: row.answered_at,
    scores: typeof row.scores === 'object' && row.scores ? row.scores : {},
    questionnaire_version: row.questionnaire_version,
    scoring_version: row.scoring_version,
    academic_year: row.academic_year ?? null,
    response_schema_version: row.response_schema_version ?? null,
    source_layout_hash: row.source_layout_hash ?? null,
    dataMode: mode.dataMode,
    rawAnswerSemantics: mode.rawAnswerSemantics,
  };
}

/**
 * 名前 normalized 完全一致（email 解決後 · テスト/同期共用）
 * Phase 5D: email がある場合は name へ fallback しない。
 * fuzzy / 部分一致 / 自動作成は行わない。
 */
export function resolveStudentMatchFromList({ respondentEmail, respondentName, students }) {
  return classifyStudentMatch({ respondentEmail, respondentName, students });
}

/**
 * Phase 5D: listStudents 上で case-insensitive email / name を分類。
 * email 未一致時は氏名へ自動 fallback しない。
 */
export async function matchStudentForAssessment({ respondentEmail, respondentName }) {
  const students = await listStudents({ activeOnly: false });
  return classifyStudentMatch({ respondentEmail, respondentName, students });
}

export async function listPsychAssessments({ studentId } = {}) {
  const sql = getDb();
  if (studentId) {
    const rows = await sql`
      SELECT id, student_id, respondent_name, respondent_email, answered_at,
             source, source_response_id, questionnaire_version, scoring_version,
             scores, academic_year, response_schema_version, source_layout_hash,
             created_at, updated_at
      FROM psych_assessments
      WHERE student_id = ${studentId}
      ORDER BY answered_at DESC, created_at DESC
    `;
    return rows.map(mapPsychAssessmentForClient);
  }

  const rows = await sql`
    SELECT id, student_id, respondent_name, respondent_email, answered_at,
           source, source_response_id, questionnaire_version, scoring_version,
           scores, academic_year, response_schema_version, source_layout_hash,
           created_at, updated_at
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
  itemAnswers = null,
  questionnaireVersion,
  scoringVersion,
  scores,
  studentId,
  academicYear = null,
  responseSchemaVersion = null,
  sourceLayoutHash = null,
}) {
  const sql = getDb();

  const existingRows = await sql`
    SELECT academic_year, response_schema_version, source_layout_hash
    FROM psych_assessments
    WHERE source = ${source} AND source_response_id = ${sourceResponseId}
    LIMIT 1
  `;
  const existing = existingRows[0] || null;
  const existingYear = existing?.academic_year ?? null;
  const yearCheck = assertAcademicYearUpsertAllowed(existingYear, academicYear);
  if (!yearCheck.ok) {
    throw new Error(yearCheck.error);
  }

  if (responseSchemaVersion != null) {
    const schemaCheck = assertResponseSchemaUpsertAllowed(
      existing?.response_schema_version ?? null,
      responseSchemaVersion,
    );
    if (!schemaCheck.ok) {
      throw new Error(schemaCheck.error);
    }
  }

  if (sourceLayoutHash != null) {
    const layoutCheck = assertSourceLayoutUpsertAllowed(
      existing?.source_layout_hash ?? null,
      sourceLayoutHash,
    );
    if (!layoutCheck.ok) {
      throw new Error(layoutCheck.error);
    }
  }

  const itemAnswersJson = itemAnswers == null ? null : JSON.stringify(itemAnswers);
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
      scores,
      item_answers,
      academic_year,
      response_schema_version,
      source_layout_hash
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
      ${JSON.stringify(scores || {})}::jsonb,
      ${itemAnswersJson}::jsonb,
      ${academicYear},
      ${responseSchemaVersion},
      ${sourceLayoutHash}
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
      item_answers = EXCLUDED.item_answers,
      academic_year = COALESCE(psych_assessments.academic_year, EXCLUDED.academic_year),
      response_schema_version = COALESCE(
        psych_assessments.response_schema_version,
        EXCLUDED.response_schema_version
      ),
      source_layout_hash = COALESCE(
        psych_assessments.source_layout_hash,
        EXCLUDED.source_layout_hash
      ),
      updated_at = NOW()
    RETURNING id, student_id, academic_year, response_schema_version, source_layout_hash
  `;
  return rows[0];
}

function validateSyncResponse(item, { questionnaireVersion } = {}) {
  const sourceResponseId = String(item?.source_response_id || '').trim();
  if (!sourceResponseId) return { ok: false, error: 'source_response_id is required' };

  const answeredAt = parseAnsweredAt(item?.answered_at);
  if (!answeredAt) return { ok: false, error: 'answered_at is invalid' };

  const rawAnswers = item?.raw_answers;
  if (!rawAnswers || typeof rawAnswers !== 'object' || Array.isArray(rawAnswers)) {
    return { ok: false, error: 'raw_answers must be an object' };
  }

  const filteredRaw = filterRawAnswersForSync(rawAnswers);
  const requireItemAnswers = isV3QuestionnaireVersion(questionnaireVersion);
  const itemAnswersResult = validateItemAnswersField(item?.item_answers, {
    required: requireItemAnswers,
  });
  if (!itemAnswersResult.ok) {
    return { ok: false, error: itemAnswersResult.error };
  }

  const academicYearResult = validateAcademicYearForSync(item?.academic_year, {
    required: requireItemAnswers,
  });
  if (!academicYearResult.ok) {
    return { ok: false, error: academicYearResult.error };
  }

  let responseSchemaVersion = null;
  let sourceLayoutHash = null;
  if (requireItemAnswers) {
    const schemaFields = validateSemanticV3SchemaFields(item);
    if (!schemaFields.ok) {
      return { ok: false, error: schemaFields.error };
    }
    responseSchemaVersion = schemaFields.value.responseSchemaVersion;
    sourceLayoutHash = schemaFields.value.sourceLayoutHash;
  } else if (item?.response_schema_version != null && String(item.response_schema_version).trim() !== '') {
    // legacy physical / v1 path への schema 再取り込みは禁止
    if (String(item.response_schema_version).trim() === RESPONSE_SCHEMA_LEGACY_PHYSICAL_V1) {
      return { ok: false, error: 'legacy_schema_frozen' };
    }
    if (String(item.response_schema_version).trim() === RESPONSE_SCHEMA_SEMANTIC_ITEMID_V3) {
      return { ok: false, error: 'semantic schema requires v3 questionnaire_version' };
    }
  }

  return {
    ok: true,
    value: {
      sourceResponseId,
      answeredAt,
      respondentName: item.respondent_name ? String(item.respondent_name).trim() : null,
      respondentEmail: item.respondent_email ? String(item.respondent_email).trim().toLowerCase() : null,
      rawAnswers: filteredRaw,
      itemAnswers: itemAnswersResult.value,
      academicYear: academicYearResult.value,
      responseSchemaVersion,
      sourceLayoutHash,
    },
  };
}

/** @internal tests — batch 部分成功の validation 確認用 */
export function validateSyncResponseForTest(item, opts) {
  return validateSyncResponse(item, opts);
}

/**
 * sync payload の questionnaire_version を解決。
 * 欠落 → v1 legacy 互換。明示 v1/v3 のみ許可。未知 version は fail closed。
 * @returns {{ ok: true, version: string, kind: 'v1'|'v3' } | { ok: false, error: string }}
 */
export function resolveSyncQuestionnaireVersion(questionnaireVersion) {
  const raw = questionnaireVersion == null || questionnaireVersion === ''
    ? ''
    : String(questionnaireVersion).trim();

  if (!raw) {
    return {
      ok: true,
      version: MEMBER_ANALYSIS_QUESTIONNAIRE_V1.questionnaire_version,
      kind: 'v1',
    };
  }
  if (isV3QuestionnaireVersion(raw)) {
    return { ok: true, version: raw, kind: 'v3' };
  }
  if (raw === QUESTIONNAIRE_VERSION_V1 || raw === MEMBER_ANALYSIS_QUESTIONNAIRE_V1.questionnaire_version) {
    return { ok: true, version: raw, kind: 'v1' };
  }
  return { ok: false, error: `unsupported questionnaire_version: ${raw}` };
}

export async function syncPsychAssessmentBatch({
  source = PSYCH_SOURCE_GOOGLE_FORMS_SHEET,
  questionnaireVersion,
  responses = [],
}) {
  const resolved = resolveSyncQuestionnaireVersion(questionnaireVersion);
  if (!resolved.ok) {
    return {
      ok: false,
      error: resolved.error,
      received: responses.length,
      synced: 0,
      skipped: 0,
      failed: responses.length,
      results: [],
    };
  }

  const qVersion = resolved.version;
  const isV3 = resolved.kind === 'v3';

  // v1 採点には header mapping が必要。v3 は item_answers scorer。
  if (!isV3 && !isQuestionnaireMappingReady()) {
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

  const results = [];
  let synced = 0;
  let skipped = 0;
  let failed = 0;

  for (const item of responses) {
    const validated = validateSyncResponse(item, { questionnaireVersion: qVersion });
    if (!validated.ok) {
      failed += 1;
      results.push({
        source_response_id: item?.source_response_id || null,
        status: 'failed',
        error: validated.error,
      });
      continue;
    }

    const {
      sourceResponseId,
      answeredAt,
      respondentName,
      respondentEmail,
      rawAnswers,
      itemAnswers,
      academicYear,
      responseSchemaVersion,
      sourceLayoutHash,
    } = validated.value;

    try {
      let scoringVersion;
      let scores;
      let warnings;

      if (isV3) {
        const scoredV3 = scoreMemberAssessmentV3(itemAnswers);
        if (!scoredV3.ok) {
          throw new Error(scoredV3.error);
        }
        scoringVersion = scoredV3.scoring_version;
        scores = scoredV3.scores;
        warnings = undefined;
      } else {
        const scored = scoreMemberAssessment(rawAnswers, MEMBER_ANALYSIS_QUESTIONNAIRE_V1);
        scoringVersion = scored.scoring_version;
        scores = scored.scores;
        warnings = scored.warnings?.length ? scored.warnings : undefined;
      }

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
        itemAnswers: isV3 ? itemAnswers : null,
        questionnaireVersion: qVersion,
        scoringVersion,
        scores,
        studentId,
        academicYear: isV3 ? academicYear : null,
        responseSchemaVersion: isV3 ? responseSchemaVersion : null,
        sourceLayoutHash: isV3 ? sourceLayoutHash : null,
      });

      synced += 1;
      results.push({
        source_response_id: sourceResponseId,
        status: isUnlinkedStudentMatchMethod(matchMethod)
          ? 'unmatched_student'
          : 'synced',
        student_id: studentId,
        assessment_id: row?.id || null,
        match_method: matchMethod,
        warnings,
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
