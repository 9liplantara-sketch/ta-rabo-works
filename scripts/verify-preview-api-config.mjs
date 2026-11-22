/**
 * Preview API 接続設定: 未許可ホスト拒否・欠落時の本番フォールバック禁止・OAuth bridge。
 */
import assert from 'node:assert/strict';
import {
  PRODUCTION_API_BASE,
  normalizeApiBase,
  resolveApiBase,
  resolveApiMode,
  storageKeySuffix,
  isAllowedApiBase,
} from '../lib/ta-rabo-api-config.js';
import {
  authBridgeFilenameForNext,
  buildAuthBridgeUrl,
  sanitizeAuthNext,
} from '../lib/auth.js';

const PREVIEW = 'https://ta-rabo-works-git-cursor-daily-report-media-preview-abc.vercel.app';
const OTHER = 'https://evil-app.vercel.app';

function expectThrow(fn, code) {
  let caught = null;
  try {
    fn();
  } catch (e) {
    caught = e;
  }
  assert.ok(caught, 'expected throw');
  if (code) assert.equal(caught.code, code);
  return caught;
}

console.log('1) production mode ignores configuredBase / wildcards');
assert.equal(resolveApiMode(''), 'production');
assert.equal(
  resolveApiBase({
    mode: 'production',
    configuredBase: OTHER,
    allowlist: [OTHER],
  }),
  PRODUCTION_API_BASE
);
assert.equal(storageKeySuffix('production'), '');
assert.equal(storageKeySuffix('preview'), '__preview');

console.log('2) preview requires exact allowlist match');
assert.equal(
  resolveApiBase({
    mode: 'preview',
    configuredBase: PREVIEW,
    allowlist: [PREVIEW],
  }),
  PREVIEW
);
assert.equal(
  resolveApiBase({
    mode: 'preview',
    configuredBase: PREVIEW + '/',
    allowlist: [PREVIEW],
  }),
  PREVIEW
);

console.log('3) missing preview config does not fall back to production');
expectThrow(
  () =>
    resolveApiBase({
      mode: 'preview',
      configuredBase: '',
      allowlist: [PREVIEW],
    }),
  'api_config_missing'
);
expectThrow(
  () => resolveApiBase({ mode: 'preview', configuredBase: '', allowlist: [] }),
  'api_config_missing'
);
assert.equal(resolveApiBase({ mode: 'production' }), PRODUCTION_API_BASE);

console.log('4) disallowed host is rejected (no token/auth_code destination)');
expectThrow(
  () =>
    resolveApiBase({
      mode: 'preview',
      configuredBase: OTHER,
      allowlist: [PREVIEW],
    }),
  'api_config_not_allowed'
);
assert.equal(
  isAllowedApiBase(OTHER, { mode: 'preview', allowlist: [PREVIEW] }),
  false
);
assert.equal(
  isAllowedApiBase(PREVIEW, { mode: 'preview', allowlist: [PREVIEW] }),
  true
);
assert.equal(
  isAllowedApiBase(PRODUCTION_API_BASE, { mode: 'production' }),
  true
);

console.log('5) OAuth return uses preview bridge and keeps preview next');
assert.equal(sanitizeAuthNext('lab_manager.preview.html'), 'lab_manager.preview.html');
assert.equal(authBridgeFilenameForNext('lab_manager.preview.html'), 'auth_bridge.preview.html');
assert.equal(authBridgeFilenameForNext('lab_manager.html'), 'auth_bridge.html');

const bridge = buildAuthBridgeUrl('lab_manager.preview.html', 'http://127.0.0.1:8765');
assert.equal(bridge.origin, 'http://127.0.0.1:8765');
assert.match(bridge.pathname, /\/auth_bridge\.preview\.html$/);
assert.equal(bridge.searchParams.get('next'), 'lab_manager.preview.html');

const prodBridge = buildAuthBridgeUrl('lab_manager.html', 'https://works.ta-rabo.com');
assert.match(prodBridge.pathname, /\/auth_bridge\.html$/);
assert.ok(!prodBridge.pathname.includes('preview'));

console.log('6) normalize strips trailing slash only');
assert.equal(normalizeApiBase('https://x.vercel.app/'), 'https://x.vercel.app');

console.log('verify-preview-api-config: ok');
