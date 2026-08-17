/**
 * Member analysis psych assessments — list (admin) + GAS sync + M3 qualitative
 *
 * Rewrites (vercel.json):
 *   /api/psych-assessments/sync → /api/psych-assessments?action=sync
 *
 * M3 qualitative actions (admin only):
 *   GET  ?action=qualitative-profile&student_id=
 *   GET  ?action=qualitative-candidates&student_id=
 *   GET  ?action=qualitative-history&student_id=
 *   GET  ?action=qualitative-evidence&item_id=
 *   POST ?action=qualitative-analyze  { student_id, window_start?, window_end? }
 *   PATCH ?action=qualitative-review  { item_id, action, ... }
 */
import { requireSession, enrichUserFromDb } from '../lib/auth.js';
import { withCors, readJsonBody } from '../lib/http.js';
import {
  listPsychAssessments,
  syncPsychAssessmentBatch,
  PSYCH_SOURCE_GOOGLE_FORMS_SHEET,
} from '../lib/psych-assessments.js';
import { requireMemberAnalysisSyncSecret } from '../lib/member-analysis-sync-auth.js';
import { assertQualitativeAdmin } from '../lib/member-qualitative-access.js';
import {
  getCurrentQualitativeProfile,
  listQualitativeCandidates,
  listAnalysisRuns,
  runQualitativeAnalysis,
  reviewQualitativeItem,
  getEvidenceDetailForItem,
  getQualitativeStatus,
  assertQualitativeTablesReadyAsync,
} from '../lib/member-qualitative-profile.js';

const QUALITATIVE_ACTIONS = new Set([
  'qualitative-status',
  'qualitative-profile',
  'qualitative-candidates',
  'qualitative-history',
  'qualitative-evidence',
  'qualitative-analyze',
  'qualitative-review',
]);

function sendQualitativeError(res, e) {
  const status = e.status || 500;
  const code = e.code || e.message || 'qualitative_action_failed';
  res.status(status).json({ error: code });
}

function resolveAction(req) {
  const action = String(req.query?.action || '').trim();
  if (action) return action;
  if (String(req.url || '').includes('/sync')) return 'sync';
  return '';
}

function isSyncRequest(req) {
  return resolveAction(req) === 'sync';
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

async function handleQualitativeAction(req, res, user, action) {
  assertQualitativeAdmin(user);

  if (action === 'qualitative-status') {
    if (req.method !== 'GET') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }
    const status = await getQualitativeStatus();
    res.status(200).json(status);
    return;
  }

  await assertQualitativeTablesReadyAsync();

  if (action === 'qualitative-profile') {
    if (req.method !== 'GET') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }
    const studentId = String(req.query?.student_id || '').trim();
    if (!studentId) {
      res.status(400).json({ error: 'student_id は必須です' });
      return;
    }
    const items = await getCurrentQualitativeProfile(user, studentId);
    res.status(200).json({ items });
    return;
  }

  if (action === 'qualitative-candidates') {
    if (req.method !== 'GET') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }
    const studentId = String(req.query?.student_id || '').trim();
    if (!studentId) {
      res.status(400).json({ error: 'student_id は必須です' });
      return;
    }
    const items = await listQualitativeCandidates(user, studentId);
    res.status(200).json({ items });
    return;
  }

  if (action === 'qualitative-history') {
    if (req.method !== 'GET') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }
    const studentId = String(req.query?.student_id || '').trim();
    if (!studentId) {
      res.status(400).json({ error: 'student_id は必須です' });
      return;
    }
    const runs = await listAnalysisRuns(user, studentId);
    res.status(200).json({ runs });
    return;
  }

  if (action === 'qualitative-evidence') {
    if (req.method !== 'GET') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }
    const itemId = String(req.query?.item_id || '').trim();
    if (!itemId) {
      res.status(400).json({ error: 'item_id は必須です' });
      return;
    }
    const evidence = await getEvidenceDetailForItem(user, itemId);
    res.status(200).json({ evidence });
    return;
  }

  if (action === 'qualitative-analyze') {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }
    const body = readJsonBody(req);
    const studentId = String(body.student_id || body.studentId || '').trim();
    if (!studentId) {
      res.status(400).json({ error: 'student_id は必須です' });
      return;
    }
    const result = await runQualitativeAnalysis(user, studentId, body);
    res.status(200).json(result);
    return;
  }

  if (action === 'qualitative-review') {
    if (req.method !== 'PATCH') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }
    const body = readJsonBody(req);
    const result = await reviewQualitativeItem(user, body);
    res.status(200).json(result);
    return;
  }

  res.status(400).json({ error: 'Unknown qualitative action' });
}

export default withCors(async (req, res) => {
  if (isSyncRequest(req)) {
    await handlePsychAssessmentSync(req, res);
    return;
  }

  const action = resolveAction(req);
  if (QUALITATIVE_ACTIONS.has(action)) {
    try {
      const session = await requireSession(req);
      const user = await enrichUserFromDb(session);
      await handleQualitativeAction(req, res, user, action);
    } catch (e) {
      sendQualitativeError(res, e);
    }
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
