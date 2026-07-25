import { OAuth2Client } from 'google-auth-library';
import {
  getGoogleOAuthClient,
  createExchangeToken,
  resolveUserFromEmail,
  getFrontendUrl,
} from '../lib/auth.js';
import { withCors } from '../lib/http.js';

const ALLOWED_NEXT = new Set([
  'lab_manager.html',
  'lab_expression.html',
]);

function sanitizeNext(raw) {
  const value = String(raw || '').trim();
  return ALLOWED_NEXT.has(value) ? value : '';
}

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

  // OAuth state（google.js が渡す next）を優先。無い場合はフロントの auth_bridge が localStorage を見る。
  const next = sanitizeNext(req.query?.state);
  const bridge = new URL(`${getFrontendUrl()}/auth_bridge.html`);
  if (next) bridge.searchParams.set('next', next);

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
