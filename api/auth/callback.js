import { OAuth2Client } from 'google-auth-library';
import {
  getGoogleOAuthClient,
  createExchangeToken,
  resolveUserFromEmail,
  getFrontendUrl,
} from '../lib/auth.js';
import { withCors } from '../lib/http.js';

export default withCors(async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const code = req.query?.code;
  if (!code) {
    res.status(400).json({ error: 'Missing code' });
    return;
  }

  const { clientId, clientSecret, redirectUri } = getGoogleOAuthClient();
  const client = new OAuth2Client(clientId, clientSecret, redirectUri);
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);

  const ticket = await client.verifyIdToken({
    idToken: tokens.id_token,
    audience: clientId,
  });
  const payload = ticket.getPayload();
  const email = payload?.email;
  const name = payload?.name || email;

  if (!email || !payload?.email_verified) {
    res.redirect(302, `${getFrontendUrl()}/lab_manager.html?auth_error=unverified`);
    return;
  }

  const user = await resolveUserFromEmail(email, name);
  if (!user) {
    res.redirect(302, `${getFrontendUrl()}/lab_manager.html?auth_error=not_allowed`);
    return;
  }

  const exchangeToken = await createExchangeToken(user);
  const redirect = `${getFrontendUrl()}/lab_manager.html?auth_code=${encodeURIComponent(exchangeToken)}`;
  res.redirect(302, redirect);
});
