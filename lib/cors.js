const DEFAULT_ORIGINS = [
  'https://works.ta-rabo.com',
  'https://9liplantara-sketch.github.io',
  'https://ta-rabo-works.vercel.app',
  'http://localhost:8765',
  'http://127.0.0.1:8765',
];

export function getAllowedOrigins() {
  const fromEnv = (process.env.API_ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  // Env may add origins. It must not drop the defaults: a secret allowlist
  // cannot be read back, and replacing defaults hid works.ta-rabo.com.
  if (!fromEnv.length) return DEFAULT_ORIGINS;
  return [...new Set([...DEFAULT_ORIGINS, ...fromEnv])];
}

export function applyCors(req, res) {
  const origin = req.headers.origin || '';
  const allowed = getAllowedOrigins();
  const match = allowed.find((o) => origin === o);
  if (match) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
}

export function handleOptions(req, res) {
  applyCors(req, res);
  res.status(204).end();
  return true;
}
