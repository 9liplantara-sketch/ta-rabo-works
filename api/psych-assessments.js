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
 *   GET  ?action=qualitative-preflight&student_id=  (read-only source counts / isolation)
 *   POST ?action=qualitative-analyze  { student_id, window_start?, window_end? }
 *   PATCH ?action=qualitative-review  { item_id, action, ... }
 *
 * Phase 6B consent (admin only; records separately obtained consent — not Form auto-grant):
 *   GET  ?action=consent-status&student_id=&consent_type?=
 *   POST ?action=consent-record  { student_id, consent_type?, policy_version, consented_at }
 *   POST ?action=consent-withdraw { student_id, consent_type?, withdrawn_at? }
 *
 * M3-L worker actions (worker secret only):
 *   POST ?action=qualitative-worker-claim
 *   POST ?action=qualitative-worker-heartbeat
 *   POST ?action=qualitative-worker-submit
 *   POST ?action=qualitative-worker-fail
 */
import { requireSession, enrichUserFromDb } from '../lib/auth.js';
import { withCors, readJsonBody } from '../lib/http.js';
import {
  listPsychAssessments,
  syncPsychAssessmentBatch,
  PSYCH_SOURCE_GOOGLE_FORMS_SHEET,
} from '../lib/psych-assessments.js';
import { requireMemberAnalysisSyncSecret } from '../lib/member-analysis-sync-auth.js';
import { requireMemberAnalysisWorkerSecret } from '../lib/member-analysis-worker-auth.js';
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
import {
  claimNextWorkerJob,
  heartbeatWorkerJob,
  submitWorkerJobResult,
  failWorkerJob,
  assertWorkerColumnsReadyAsync,
} from '../lib/member-qualitative-worker.js';

import {
  getConsentStatusForStudent,
  recordConsentEpisode,
  withdrawConsentEpisode,
  assertConsentRecordsTableReadyAsync,
  LOCAL_AI_ANALYSIS_PURPOSE,
} from '../lib/member-local-ai-consent.js';
import { runQualitativeAnalysisPreflight } from '../lib/member-qualitative-preflight.js';

const QUALITATIVE_ACTIONS = new Set([
  'qualitative-status',
  'qualitative-profile',
  'qualitative-candidates',
  'qualitative-history',
  'qualitative-evidence',
  'qualitative-preflight',
  'qualitative-analyze',
  'qualitative-review',
  'consent-status',
  'consent-record',
  'consent-withdraw',
]);

const WORKER_ACTIONS = new Set([
  'qualitative-worker-claim',
  'qualitative-worker-heartbeat',
  'qualitative-worker-submit',
  'qualitative-worker-fail',
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

  if (action === 'qualitative-preflight') {
    if (req.method !== 'GET') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }
    const studentId = String(req.query?.student_id || req.query?.studentId || '').trim();
    if (!studentId) {
      res.status(400).json({ error: 'student_id は必須です' });
      return;
    }
    const preflight = await runQualitativeAnalysisPreflight(user, studentId, {
      window_start: req.query?.window_start || req.query?.windowStart,
      window_end: req.query?.window_end || req.query?.windowEnd,
    });
    res.status(200).json(preflight);
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
    res.status(result.httpStatus || 200).json(result);
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


  if (action === 'consent-status') {
    if (req.method !== 'GET') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }
    await assertConsentRecordsTableReadyAsync();
    const studentId = String(req.query?.student_id || req.query?.studentId || '').trim();
    if (!studentId) {
      res.status(400).json({ error: 'student_id は必須です' });
      return;
    }
    const consentType = String(req.query?.consent_type || req.query?.consentType || LOCAL_AI_ANALYSIS_PURPOSE).trim();
    const status = await getConsentStatusForStudent(studentId, consentType);
    res.status(200).json(status);
    return;
  }

  if (action === 'consent-record') {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }
    await assertConsentRecordsTableReadyAsync();
    const body = readJsonBody(req);
    const recorded = await recordConsentEpisode({
      studentId: String(body.student_id || body.studentId || '').trim(),
      consentType: body.consent_type || body.consentType || LOCAL_AI_ANALYSIS_PURPOSE,
      policyVersion: body.policy_version || body.policyVersion,
      consentedAt: body.consented_at || body.consentedAt,
      source: 'admin_recorded',
    });
    res.status(201).json({
      ok: true,
      consent: recorded,
      note: 'admin_recorded: documents separately obtained consent; API call is not itself consent capture',
    });
    return;
  }

  if (action === 'consent-withdraw') {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }
    await assertConsentRecordsTableReadyAsync();
    const body = readJsonBody(req);
    const withdrawn = await withdrawConsentEpisode({
      studentId: String(body.student_id || body.studentId || '').trim(),
      consentType: body.consent_type || body.consentType || LOCAL_AI_ANALYSIS_PURPOSE,
      withdrawnAt: body.withdrawn_at || body.withdrawnAt,
    });
    res.status(200).json({ ok: true, consent: withdrawn });
    return;
  }

  res.status(400).json({ error: 'Unknown qualitative action' });
}

function sendWorkerError(res, e) {
  const status = e.status || 500;
  const code = e.code || e.message || 'worker_action_failed';
  res.status(status).json({ error: code });
}

async function handleWorkerAction(req, res, action) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  await assertQualitativeTablesReadyAsync();
  await assertWorkerColumnsReadyAsync();

  const body = readJsonBody(req);

  if (action === 'qualitative-worker-claim') {
    const workerId = String(body.worker_id || body.workerId || process.env.MEMBER_ANALYSIS_WORKER_ID || 'local-worker').trim();
    const runId = String(body.run_id || body.runId || '').trim();
    const result = await claimNextWorkerJob(workerId, runId ? { runId } : {});
    res.status(200).json(result);
    return;
  }

  if (action === 'qualitative-worker-heartbeat') {
    const result = await heartbeatWorkerJob(body);
    res.status(200).json(result);
    return;
  }

  if (action === 'qualitative-worker-submit') {
    const result = await submitWorkerJobResult(body);
    res.status(200).json(result);
    return;
  }

  if (action === 'qualitative-worker-fail') {
    const result = await failWorkerJob(body);
    res.status(200).json(result);
    return;
  }

  res.status(400).json({ error: 'Unknown worker action' });
}

export default withCors(async (req, res) => {
  if (isSyncRequest(req)) {
    await handlePsychAssessmentSync(req, res);
    return;
  }

  const action = resolveAction(req);

  if (WORKER_ACTIONS.has(action)) {
    if (!requireMemberAnalysisWorkerSecret(req, res)) return;
    try {
      await handleWorkerAction(req, res, action);
    } catch (e) {
      sendWorkerError(res, e);
    }
    return;
  }

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
