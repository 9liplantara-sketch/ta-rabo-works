import { requireSession, enrichUserFromDb } from '../lib/auth.js';
import { withCors } from '../lib/http.js';
import { fetchSeminarScheduleFromGas } from '../lib/seminar-schedule-source.js';
import { syncSessionsFromSchedule } from '../lib/sessions.js';

export default withCors(async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const session = await requireSession(req);
  const user = await enrichUserFromDb(session);

  if (user.role !== 'admin') {
    res.status(403).json({ error: 'Forbidden: admin only' });
    return;
  }

  try {
    const gasData = await fetchSeminarScheduleFromGas();
    const result = await syncSessionsFromSchedule(gasData.schedule);
    res.status(200).json({
      ...result,
      schedule_updated_at: gasData.updatedAt,
    });
  } catch (err) {
    if (err.status === 400 && err.message === 'duplicate_session_key') {
      res.status(400).json({
        ok: false,
        error: 'duplicate_session_key',
        keys: err.keys || [],
        received: err.received ?? null,
        skipped: err.skipped?.length ?? 0,
        skipped_items: err.skipped || [],
      });
      return;
    }
    const status = err.status || 500;
    res.status(status).json({
      ok: false,
      error: err.message || 'Internal Server Error',
      detail: err.detail || undefined,
    });
  }
});
