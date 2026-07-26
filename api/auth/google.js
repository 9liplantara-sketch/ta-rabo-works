import { OAuth2Client } from 'google-auth-library';
import { getGoogleOAuthClient, createExchangeToken, resolveUserFromEmail, getFrontendUrl } from '../lib/auth.js';
import { withCors } from '../lib/http.js';

const ALLOWED_NEXT = new Set([
  'lab_manager.html',
  'lab_expression.html',
  'lesson_design.html',
]);

function sanitizeNext(raw) {
  const value = String(raw || 'lab_manager.html').trim();
  if (ALLOWED_NEXT.has(value)) return value;
  return 'lab_manager.html';
}

export default withCors(async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { clientId, clientSecret, redirectUri } = getGoogleOAuthClient();
  const client = new OAuth2Client(clientId, clientSecret, redirectUri);
  const next = sanitizeNext(req.query?.next);

  const url = client.generateAuthUrl({
    access_type: 'online',
    prompt: 'select_account',
    scope: ['openid', 'email', 'profile'],
    state: next,
  });

  res.redirect(302, url);
});
