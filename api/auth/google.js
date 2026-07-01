import { OAuth2Client } from 'google-auth-library';
import { getGoogleOAuthClient, createExchangeToken, resolveUserFromEmail, getFrontendUrl } from '../lib/auth.js';
import { withCors } from '../lib/http.js';

export default withCors(async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { clientId, clientSecret, redirectUri } = getGoogleOAuthClient();
  const client = new OAuth2Client(clientId, clientSecret, redirectUri);

  const url = client.generateAuthUrl({
    access_type: 'online',
    prompt: 'select_account',
    scope: ['openid', 'email', 'profile'],
  });

  res.redirect(302, url);
});
