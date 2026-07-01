import { verifyToken, createSessionToken } from '../lib/auth.js';
import { withCors, readJsonBody } from '../lib/http.js';

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
  const user = {
    email: payload.email,
    name: payload.name,
    role: payload.role,
    studentId: payload.studentId || null,
  };

  const token = await createSessionToken(user);
  res.status(200).json({ token, user });
});
