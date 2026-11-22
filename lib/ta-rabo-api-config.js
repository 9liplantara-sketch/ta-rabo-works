/**
 * フロントの API 接続先解決（本番固定 / Preview 完全一致 allowlist）。
 * 任意 *.vercel.app やクエリ上書きは許可しない。
 */

export const PRODUCTION_API_BASE = 'https://ta-rabo-works.vercel.app';

export const PREVIEW_STORAGE_SUFFIX = '__preview';

export function normalizeApiBase(raw) {
  return String(raw || '').trim().replace(/\/$/, '');
}

export function resolveApiMode(rawMode) {
  return String(rawMode || '').trim().toLowerCase() === 'preview' ? 'preview' : 'production';
}

export function storageKeySuffix(mode) {
  return resolveApiMode(mode) === 'preview' ? PREVIEW_STORAGE_SUFFIX : '';
}

/**
 * @param {{ mode?: string, configuredBase?: string, allowlist?: string[] }} opts
 * @returns {string}
 */
export function resolveApiBase(opts = {}) {
  const mode = resolveApiMode(opts.mode);
  if (mode !== 'preview') {
    return PRODUCTION_API_BASE;
  }

  const base = normalizeApiBase(opts.configuredBase);
  const allowlist = Array.isArray(opts.allowlist)
    ? opts.allowlist.map(normalizeApiBase).filter(Boolean)
    : [];

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

/** 送信先ホストが許可されているか（未許可なら token / auth_code を送らない） */
export function isAllowedApiBase(base, opts = {}) {
  try {
    return resolveApiBase({ ...opts, configuredBase: base }) === normalizeApiBase(base);
  } catch {
    return false;
  }
}
