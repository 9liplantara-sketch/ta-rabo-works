/* 本番は固定 URL。Preview は完全一致 allowlist のみ。?apiBase= は使わない。
 * 正本ロジックは lib/ta-rabo-api-config.js と揃えること。
 */
(function (global) {
  const PRODUCTION_API_BASE = 'https://ta-rabo-works.vercel.app';
  const PREVIEW_STORAGE_SUFFIX = '__preview';

  function normalizeApiBase(raw) {
    return String(raw || '').trim().replace(/\/$/, '');
  }

  function resolveApiMode(rawMode) {
    return String(rawMode || '').trim().toLowerCase() === 'preview' ? 'preview' : 'production';
  }

  function storageKeySuffix(mode) {
    return resolveApiMode(mode) === 'preview' ? PREVIEW_STORAGE_SUFFIX : '';
  }

  function readPageProfile() {
    try {
      return String(global.sessionStorage.getItem('ta_rabo_page_profile') || '');
    } catch (_) {
      return '';
    }
  }

  /** 本番フロントでは Preview 設定を無視して常に本番 API。 */
  function isProductionFrontendHost() {
    try {
      const h = String((global.location && global.location.hostname) || '');
      return h === 'works.ta-rabo.com' || h === 'ta-rabo-works.vercel.app';
    } catch (_) {
      return false;
    }
  }

  function currentMode() {
    if (isProductionFrontendHost()) return 'production';
    if (resolveApiMode(global.TA_RABO_API_MODE) === 'preview') return 'preview';
    if (readPageProfile() === 'preview') return 'preview';
    return 'production';
  }

  function currentAllowlist() {
    return Array.isArray(global.TA_RABO_PREVIEW_API_ALLOWLIST)
      ? global.TA_RABO_PREVIEW_API_ALLOWLIST
      : [];
  }

  function resolveApiBase(opts) {
    const o = opts || {};
    const mode = resolveApiMode(o.mode != null ? o.mode : currentMode());
    if (mode !== 'preview') {
      return PRODUCTION_API_BASE;
    }

    const base = normalizeApiBase(
      o.configuredBase != null ? o.configuredBase : global.TA_RABO_API_BASE
    );
    const allowlist = (Array.isArray(o.allowlist) ? o.allowlist : currentAllowlist())
      .map(normalizeApiBase)
      .filter(Boolean);

    if (!base) {
      const err = new Error(
        '検証用 API の接続先が未設定です。ta-rabo-preview-config.js に完全一致の URL を設定してください。'
      );
      err.code = 'api_config_missing';
      throw err;
    }

    if (!allowlist.includes(base)) {
      const err = new Error(
        '検証用 API の接続先が allowlist と一致しません。未許可ホストへは接続しません。'
      );
      err.code = 'api_config_not_allowed';
      throw err;
    }

    return base;
  }

  function assertPreviewConfigured() {
    return resolveApiBase({ mode: 'preview' });
  }

  function isAllowedApiBase(base, opts) {
    try {
      const o = opts || {};
      const resolved = resolveApiBase({
        mode: o.mode != null ? o.mode : currentMode(),
        configuredBase: base,
        allowlist: o.allowlist,
      });
      return resolved === normalizeApiBase(base);
    } catch (_) {
      return false;
    }
  }

  global.TaRaboApiConfig = {
    PRODUCTION_API_BASE,
    PREVIEW_STORAGE_SUFFIX,
    normalizeApiBase,
    resolveApiMode,
    storageKeySuffix,
    currentMode,
    resolveApiBase,
    assertPreviewConfigured,
    isAllowedApiBase,
  };
})(typeof window !== 'undefined' ? window : globalThis);
