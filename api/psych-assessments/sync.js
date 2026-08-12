import { withCors, readJsonBody } from '../lib/http.js';
import { requireMemberAnalysisSyncSecret } from '../lib/member-analysis-sync-auth.js';
import { syncPsychAssessmentBatch, PSYCH_SOURCE_GOOGLE_FORMS_SHEET } from '../lib/psych-assessments.js';

export default withCors(async (req, res) => {
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
});
