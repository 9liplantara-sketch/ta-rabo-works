import { requireSession } from '../lib/auth.js';
import { withCors } from '../lib/http.js';

export default withCors(async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const user = await requireSession(req);
  res.status(200).json({ user });
});
