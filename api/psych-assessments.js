import { requireSession, enrichUserFromDb } from '../lib/auth.js';
import { withCors } from '../lib/http.js';
import { listPsychAssessments } from '../lib/psych-assessments.js';

export default withCors(async (req, res) => {
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
