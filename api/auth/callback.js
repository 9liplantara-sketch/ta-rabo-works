import { OAuth2Client } from 'google-auth-library';
import {
  getGoogleOAuthClient,
  createExchangeToken,
  resolveUserFromEmail,
  buildAuthBridgeUrl,
} from '../../lib/auth.js';
import { withCors } from '../../lib/http.js';

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

  // state は「戻り先オリジン|ページ名」または従来のページ名だけ。
  const rawState = String(req.query?.state || '');
  const cut = rawState.lastIndexOf('|');
  const returnOrigin = cut > 0 ? rawState.slice(0, cut) : '';
  const nextPage = cut > 0 ? rawState.slice(cut + 1) : rawState;
  const bridge = buildAuthBridgeUrl(nextPage, returnOrigin);

  if (!email || !payload?.email_verified) {
    bridge.searchParams.set('auth_error', 'unverified');
    res.redirect(302, bridge.toString());
    return;
  }

  const user = await resolveUserFromEmail(email, name);
  if (!user) {
    bridge.searchParams.set('auth_error', 'not_allowed');
    res.redirect(302, bridge.toString());
    return;
  }

  const exchangeToken = await createExchangeToken(user);
  bridge.searchParams.set('auth_code', exchangeToken);
  res.redirect(302, bridge.toString());
});
