/**
 * Member analysis psych assessments — list (admin) + GAS sync
 *
 * Rewrite (vercel.json):
 *   /api/psych-assessments/sync → /api/psych-assessments?action=sync
 */
import { requireSession, enrichUserFromDb } from '../lib/auth.js';
import { withCors, readJsonBody } from '../lib/http.js';
import {
  listPsychAssessments,
  syncPsychAssessmentBatch,
  PSYCH_SOURCE_GOOGLE_FORMS_SHEET,
} from '../lib/psych-assessments.js';
import { requireMemberAnalysisSyncSecret } from '../lib/member-analysis-sync-auth.js';

function isSyncRequest(req) {
  const action = String(req.query?.action || '').trim();
  if (action === 'sync') return true;
  return String(req.url || '').includes('/sync');
}

export async function handlePsychAssessmentSync(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  if (!requireMemberAnalysisSyncSecret(req, res)) return;

  const body = readJsonBody(req);
  const source = String(body.source || PSYCH_SOURCE_GOOGLE_FORMS_SHEET).trim();
  const questionnaireVersion = body.questionnaire_version
    ? String(body.questionnaire_version).trim()
    : null;
  const responses = Array.isArray(body.responses) ? body.responses : [];

  if (!responses.length) {
    res.status(400).json({ error: 'responses must be a non-empty array' });
    return;
  }

  const result = await syncPsychAssessmentBatch({
    source,
    questionnaireVersion,
    responses,
  });

  const status = result.ok ? 200 : (result.error ? 503 : 207);
  res.status(status).json(result);
}

export default withCors(async (req, res) => {
  if (isSyncRequest(req)) {
    await handlePsychAssessmentSync(req, res);
    return;
  }

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const session = await requireSession(req);
  const user = await enrichUserFromDb(session);

  if (user.role !== 'admin') {
    res.status(403).json({ error: 'Forbidden: admin only' });
    return;
  }

  const studentId = String(req.query?.student_id || '').trim() || null;
  const assessments = await listPsychAssessments({ studentId });
  res.status(200).json({ assessments });
});
