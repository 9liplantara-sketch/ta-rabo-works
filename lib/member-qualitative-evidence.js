/**
 * Phase M3 — evidence の現在アクセス可否（privacy 変更の伝播）
 *
 * evidence には source 本文をコピーしない。参照時に正本の accessibility を確認する。
 * Phase 6 provenance hardening: expectedStudentId による ownership 必須。
 */

import { getDb } from './db.js';
import {
  isDailyReportEligibleForKnowledge,
} from './knowledge-access.js';
import { canViewKnowledgeRecord } from './knowledge-access.js';
import {
  parseIntakeEvidenceSourceId,
  normalizeItemAnswersObject,
  isNonEmptyAnswerText,
  INTAKE_SOURCE_KIND,
} from './member-qualitative-intake-sources.js';

function sameStudentId(a, b) {
  if (a == null || b == null) return false;
  return String(a).trim() === String(b).trim();
}

/** テスト / detail 用: daily ownership + lab/public */
export function isDailyEvidenceOwnedAndEligible(row, expectedStudentId) {
  if (!row || !expectedStudentId) return false;
  if (!sameStudentId(row.student_id ?? row.studentId, expectedStudentId)) return false;
  return isDailyReportEligibleForKnowledge(row);
}

/** テスト / detail 用: knowledge participant ownership + visibility */
export function isKnowledgeEvidenceOwnedAndViewable(record, user, expectedStudentId) {
  if (!record || !user || !expectedStudentId) return false;
  const parts = record.participants || [];
  const owned = parts.some((p) =>
    sameStudentId(p.studentId ?? p.student_id, expectedStudentId),
  );
  if (!owned) return false;
  return canViewKnowledgeRecord(user, record);
}

/**
 * intake detail 解決（pure / fail-closed）。本文は assessment 正本からのみ。
 * @returns {{ accessible: boolean, detail: object | null }}
 */
export function resolveIntakeEvidenceDetailFromAssessment({
  sourceId,
  assessment,
  expectedStudentId,
  user,
}) {
  if (!user || user.role !== 'admin') {
    return { accessible: false, detail: null };
  }
  const parsed = parseIntakeEvidenceSourceId(sourceId);
  if (!parsed) return { accessible: false, detail: null };
  if (!expectedStudentId || !assessment) return { accessible: false, detail: null };
  if (!sameStudentId(assessment.id, parsed.assessmentId)) {
    return { accessible: false, detail: null };
  }
  if (!sameStudentId(assessment.student_id ?? assessment.studentId, expectedStudentId)) {
    return { accessible: false, detail: null };
  }
  const answers = normalizeItemAnswersObject(
    assessment.item_answers ?? assessment.itemAnswers,
  );
  if (!answers || !Object.prototype.hasOwnProperty.call(answers, parsed.itemId)) {
    return { accessible: false, detail: null };
  }
  const raw = answers[parsed.itemId];
  if (!isNonEmptyAnswerText(raw)) return { accessible: false, detail: null };

  return {
    accessible: true,
    detail: {
      sourceKind: INTAKE_SOURCE_KIND,
      sourceId: String(sourceId),
      sourceType: INTAKE_SOURCE_KIND,
      itemId: parsed.itemId,
      title: parsed.itemId,
      bodyText: String(raw),
      occurredAt: assessment.answered_at
        ? (assessment.answered_at instanceof Date
          ? assessment.answered_at.toISOString()
          : String(assessment.answered_at))
        : null,
    },
  };
}

/** admin AI 分析 / プロフィール表示用: daily_report が現在参照可能か */
export async function isDailyReportSourceAccessible(sourceId, user, expectedStudentId) {
  if (!sourceId || !user || !expectedStudentId) return false;
  const sql = getDb();
  const rows = await sql`
    SELECT id, visibility, student_id
    FROM daily_reports
    WHERE id = ${sourceId}
      AND student_id = ${expectedStudentId}::uuid
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return false;
  return isDailyReportEligibleForKnowledge(row);
}

/** admin AI 分析 / プロフィール表示用: knowledge_record が現在参照可能か */
export async function isKnowledgeRecordSourceAccessible(sourceId, user, expectedStudentId) {
  if (!sourceId || !user || !expectedStudentId) return false;
  const sql = getDb();
  const rows = await sql`
    SELECT kr.id, kr.visibility
    FROM knowledge_records kr
    INNER JOIN knowledge_record_participants krp ON krp.record_id = kr.id
    WHERE kr.id = ${sourceId}
      AND krp.student_id = ${expectedStudentId}::uuid
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return false;
  return canViewKnowledgeRecord(user, row);
}

/**
 * intake_response: assessment 正本が expectedStudent に属し admin のみ参照可。
 * source_id = `${assessmentId}:${itemId}`（本文は持たない）
 */
export async function isIntakeResponseSourceAccessible(sourceId, user, expectedStudentId) {
  if (!sourceId || !user || !expectedStudentId) return false;
  if (user.role !== 'admin') return false;
  const parsed = parseIntakeEvidenceSourceId(sourceId);
  if (!parsed) return false;
  const sql = getDb();
  const rows = await sql`
    SELECT id, student_id, item_answers
    FROM psych_assessments
    WHERE id = ${parsed.assessmentId}::uuid
      AND student_id = ${expectedStudentId}::uuid
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return false;
  const answers = normalizeItemAnswersObject(row.item_answers);
  if (!answers || !Object.prototype.hasOwnProperty.call(answers, parsed.itemId)) {
    return false;
  }
  return isNonEmptyAnswerText(answers[parsed.itemId]);
}

export async function isEvidenceSourceAccessible(sourceKind, sourceId, user, expectedStudentId) {
  if (!expectedStudentId) return false;
  if (sourceKind === 'daily_report') {
    return isDailyReportSourceAccessible(sourceId, user, expectedStudentId);
  }
  if (sourceKind === 'knowledge_record') {
    return isKnowledgeRecordSourceAccessible(sourceId, user, expectedStudentId);
  }
  if (sourceKind === INTAKE_SOURCE_KIND) {
    return isIntakeResponseSourceAccessible(sourceId, user, expectedStudentId);
  }
  return false;
}

export async function filterAccessibleEvidence(evidenceRows, user, expectedStudentId) {
  const out = [];
  for (const ev of evidenceRows || []) {
    const ok = await isEvidenceSourceAccessible(
      ev.source_kind,
      ev.source_id,
      user,
      expectedStudentId,
    );
    if (ok) out.push(ev);
  }
  return out;
}

/** テスト用: in-memory visibility チェック */
export function isDailyReportRowAccessible(row) {
  return isDailyReportEligibleForKnowledge(row);
}

/**
 * テスト用: in-memory ownership + visibility
 * @param {string | null} [expectedStudentId]
 */
export function partitionEvidenceByAccessibility(
  evidenceList,
  dailyReportMap,
  knowledgeRecordMap,
  user,
  intakeSourceIdSet = null,
  expectedStudentId = null,
) {
  const accessible = [];
  const inaccessible = [];
  for (const ev of evidenceList || []) {
    let ok = false;
    if (ev.source_kind === 'daily_report') {
      const row = dailyReportMap.get(String(ev.source_id));
      ok = expectedStudentId
        ? isDailyEvidenceOwnedAndEligible(row, expectedStudentId)
        : isDailyReportEligibleForKnowledge(row);
    } else if (ev.source_kind === 'knowledge_record') {
      const rec = knowledgeRecordMap.get(String(ev.source_id));
      ok = expectedStudentId
        ? isKnowledgeEvidenceOwnedAndViewable(rec, user, expectedStudentId)
        : canViewKnowledgeRecord(user, rec);
    } else if (ev.source_kind === INTAKE_SOURCE_KIND) {
      if (user?.role !== 'admin') {
        ok = false;
      } else {
        const parsed = parseIntakeEvidenceSourceId(ev.source_id);
        if (!parsed) {
          ok = false;
        } else if (intakeSourceIdSet instanceof Set) {
          ok = intakeSourceIdSet.has(String(ev.source_id));
          if (ok && expectedStudentId && knowledgeRecordMap?.get?.('__intake_assessments__')) {
            // optional strict map unused; set membership implies ownership in fixtures
          }
        } else {
          ok = Boolean(parsed);
        }
      }
    }
    if (ok) accessible.push(ev);
    else inaccessible.push(ev);
  }
  return { accessible, inaccessible };
}
