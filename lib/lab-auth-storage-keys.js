/**
 * ta-rabo-auth.js が localStorage に使うキー（lab_manager の purge 等と共有）
 * 旧 TA_RABO_SESSION_KEY グローバルは廃止済み。正本は ta-rabo-auth.js の定数。
 */
export const AUTH_SESSION_STORAGE_KEY = 'ta_rabo_session_token';
export const AUTH_USER_STORAGE_KEY = 'ta_rabo_session_user';

/** @param {{ SESSION_KEY?: string, USER_KEY?: string } | null | undefined} authModule */
export function resolveAuthLocalStorageKeys(authModule) {
  return {
    session: authModule?.SESSION_KEY || AUTH_SESSION_STORAGE_KEY,
    user: authModule?.USER_KEY || AUTH_USER_STORAGE_KEY,
  };
}

export function shouldPreserveAuthLocalStorageKey(key, authKeys) {
  const k = String(key || '');
  return k === authKeys.session || k === authKeys.user;
}
