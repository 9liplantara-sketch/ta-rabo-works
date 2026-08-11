import { requireSession, enrichUserFromDb } from '../lib/auth.js';
import { withCors } from '../lib/http.js';
import { listSessions, parseListSessionsParams } from '../lib/sessions.js';

export default withCors(async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const session = await requireSession(req);
  await enrichUserFromDb(session);

  try {
    const params = parseListSessionsParams(req.query);
    const result = await listSessions(params);
    res.status(200).json({
      sessions: result.sessions,
      limit: result.limit,
      offset: result.offset,
    });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message || 'Internal Server Error' });
  }
});
