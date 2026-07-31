import { verifyToken, createSessionToken, resolveUserFromEmail } from '../../lib/auth.js';
import { withCors, readJsonBody } from '../../lib/http.js';

export default withCors(async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const body = readJsonBody(req);
  const authCode = body.auth_code || body.authCode;
  if (!authCode) {
    res.status(400).json({ error: 'auth_code is required' });
    return;
  }

  const payload = await verifyToken(authCode, 'exchange');
  const user = await resolveUserFromEmail(payload.email, payload.name);
  if (!user) {
    res.status(403).json({ error: 'Account not approved' });
    return;
  }

  const token = await createSessionToken(user);
  res.status(200).json({ token, user });
});
