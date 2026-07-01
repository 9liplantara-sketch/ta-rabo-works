const DEFAULT_ORIGINS = [
  'https://9liplantara-sketch.github.io',
  'http://localhost:8765',
  'http://127.0.0.1:8765',
];

export function getAllowedOrigins() {
  const fromEnv = (process.env.API_ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return fromEnv.length ? fromEnv : DEFAULT_ORIGINS;
}

export function applyCors(req, res) {
  const origin = req.headers.origin || '';
  const allowed = getAllowedOrigins();
  const match = allowed.find((o) => origin === o || origin.startsWith(o));
  if (match) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
}

export function handleOptions(req, res) {
  applyCors(req, res);
  res.status(204).end();
  return true;
}
