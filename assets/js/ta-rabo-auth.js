/* ta_rabo — Google ログイン / localStorage セッション（全ページ共通） */
(function (global) {
  const BASE_SESSION_KEY = 'ta_rabo_session_token';
  const BASE_USER_KEY = 'ta_rabo_session_user';
  const BASE_AUTH_RETURN_KEY = 'ta_rabo_auth_return';
  const ALLOWED_RETURN = new Set([
    'index.html',
    'lab_manager.html',
    'lab_manager.preview.html',
    'lab_expression.html',
    'lesson_design.html',
  ]);

  const AUTH_ERRORS = {
    not_allowed:
      'この Google アカウントは、まだ研究室メンバーとして承認されていません。利用を希望する場合は教員に連絡してください。',
    unverified:
      'メール未確認の Google アカウントです。Google 側でメールアドレスを確認してから再度お試しください。',
    exchange_failed: 'ログインに失敗しました。もう一度お試しください。',
    revoked:
      'このアカウントは現在ログインが許可されていません。利用を希望する場合は教員に連絡してください。',
    session_invalid: 'セッションの有効期限が切れました。もう一度ログインしてください。',
    api_config_invalid:
      'API 接続設定が無効です。検証設定が欠けている場合は本番へフォールバックしません。',
  };

  function cfg() {
    return global.TaRaboApiConfig || null;
  }

  function apiMode() {
    const c = cfg();
    if (c && typeof c.currentMode === 'function') return c.currentMode();
    return String(global.TA_RABO_API_MODE || '').toLowerCase() === 'preview' ? 'preview' : 'production';
  }

  function keySuffix() {
    const c = cfg();
    if (c && typeof c.storageKeySuffix === 'function') return c.storageKeySuffix(apiMode());
    return apiMode() === 'preview' ? '__preview' : '';
  }

  function SESSION_KEY() {
    return BASE_SESSION_KEY + keySuffix();
  }
  function USER_KEY() {
    return BASE_USER_KEY + keySuffix();
  }
  function AUTH_RETURN_KEY() {
    return BASE_AUTH_RETURN_KEY + keySuffix();
  }

  function getApiBase() {
    const c = cfg();
    if (c && typeof c.resolveApiBase === 'function') {
      return c.resolveApiBase();
    }
    // api-config 未読込時は本番のみ（任意 TA_RABO_API_BASE は無視）
    return 'https://ta-rabo-works.vercel.app';
  }

  function getSessionToken() {
    try {
      return localStorage.getItem(SESSION_KEY()) || '';
    } catch (_) {
      return '';
    }
  }

  function getSessionUser() {
    try {
      return JSON.parse(localStorage.getItem(USER_KEY()) || 'null');
    } catch (_) {
      return null;
    }
  }

  function setSession(token, user) {
    try {
      localStorage.setItem(SESSION_KEY(), token);
      localStorage.setItem(USER_KEY(), JSON.stringify(user));
    } catch (e) {
      console.warn('[auth] setSession failed', e);
    }
  }

  function clearSession() {
    try {
      localStorage.removeItem(SESSION_KEY());
      localStorage.removeItem(USER_KEY());
    } catch (_) {}
  }

  function cookiePath() {
    return location.pathname.includes('/ta-rabo-works') ? '/ta-rabo-works/' : '/';
  }

  function setAuthReturn(page) {
    if (!ALLOWED_RETURN.has(page)) return;
    const key = AUTH_RETURN_KEY();
    try {
      localStorage.setItem(key, page);
    } catch (_) {}
    try {
      sessionStorage.setItem(key, page);
    } catch (_) {}
    try {
      document.cookie = `${key}=${encodeURIComponent(page)}; path=${cookiePath()}; max-age=900; SameSite=Lax`;
    } catch (_) {}
  }

  function clearAuthReturn() {
    const key = AUTH_RETURN_KEY();
    try {
      localStorage.removeItem(key);
    } catch (_) {}
    try {
      sessionStorage.removeItem(key);
    } catch (_) {}
    try {
      document.cookie = `${key}=; path=${cookiePath()}; max-age=0; SameSite=Lax`;
      document.cookie = `${key}=; path=/; max-age=0; SameSite=Lax`;
    } catch (_) {}
  }

  function readAuthReturn() {
    const key = AUTH_RETURN_KEY();
    const ok = (v) =>
      ALLOWED_RETURN.has(v) &&
      v !== 'lab_manager.html' &&
      v !== 'lab_manager.preview.html' &&
      v !== 'index.html';
    try {
      const a = localStorage.getItem(key);
      if (ok(a)) return a;
    } catch (_) {}
    try {
      const b = sessionStorage.getItem(key);
      if (ok(b)) return b;
    } catch (_) {}
    try {
      const re = new RegExp('(?:^|;\\s*)' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '=([^;]+)');
      const m = document.cookie.match(re);
      if (m) {
        const c = decodeURIComponent(m[1]);
        if (ok(c)) return c;
      }
    } catch (_) {}
    return '';
  }

  function consumeAuthReturn() {
    const ret = readAuthReturn();
    if (ret) clearAuthReturn();
    return ret;
  }

  function getDisplayName(user) {
    if (!user) return '';
    return String(user.display_name || user.name || user.email || '').trim();
  }

  function isLabAdmin(user) {
    const u = user || getSessionUser();
    return !!u && u.role === 'admin';
  }

  function handleSessionInvalid(err) {
    clearSession();
    err.message = AUTH_ERRORS.session_invalid;
    err.sessionInvalid = true;
    err.code = 'session_invalid';
    try {
      if (typeof global.updateAuthUI === 'function') global.updateAuthUI();
    } catch (_) {}
    try {
      global.dispatchEvent(new CustomEvent('ta-rabo:session-invalidated', { detail: { error: err } }));
    } catch (_) {}
    try {
      global.dispatchEvent(new CustomEvent('ta-rabo:session-invalid', { detail: { error: err } }));
    } catch (_) {}
  }

  function resolveApiBaseOrThrow() {
    try {
      return getApiBase();
    } catch (e) {
      const err = new Error((e && e.message) || AUTH_ERRORS.api_config_invalid);
      err.code = (e && e.code) || 'api_config_invalid';
      err.cause = e;
      throw err;
    }
  }

  async function apiFetch(path, options) {
    const opts = options || {};
    const headers = { ...(opts.headers || {}) };
    if (!headers['Content-Type'] && opts.body) headers['Content-Type'] = 'application/json';
    const token = getSessionToken();
    if (token) headers.Authorization = `Bearer ${token}`;

    const base = resolveApiBaseOrThrow();
    const c = cfg();
    if (c && typeof c.isAllowedApiBase === 'function' && !c.isAllowedApiBase(base)) {
      const err = new Error(AUTH_ERRORS.api_config_invalid);
      err.code = 'api_config_not_allowed';
      throw err;
    }

    const res = await fetch(`${base}${path}`, { ...opts, headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || `API error ${res.status}`);
      err.status = res.status;
      err.code = data.code || null;
      err.data = data;
      if (res.status === 401 && data.code === 'session_invalid') {
        handleSessionInvalid(err);
      }
      throw err;
    }
    return data;
  }

  function defaultNextPage() {
    return apiMode() === 'preview' ? 'lab_manager.preview.html' : 'lab_manager.html';
  }

  function loginWithGoogle(nextPage) {
    const next = ALLOWED_RETURN.has(nextPage) ? nextPage : defaultNextPage();
    let base;
    try {
      base = resolveApiBaseOrThrow();
    } catch (e) {
      try {
        global.alert(e.message || AUTH_ERRORS.api_config_invalid);
      } catch (_) {}
      return;
    }
    setAuthReturn(next);
    const url = `${base}/api/auth/google?next=${encodeURIComponent(next)}&return_origin=${encodeURIComponent(global.location.origin)}`;
    global.location.assign(url);
  }

  async function exchangeAuthCode(authCode) {
    const data = await apiFetch('/api/auth/exchange', {
      method: 'POST',
      body: JSON.stringify({ auth_code: authCode }),
    });
    setSession(data.token, data.user);
    return data.user;
  }

  async function refreshSession() {
    const token = getSessionToken();
    if (!token) return null;
    const data = await apiFetch('/api/auth/me');
    setSession(token, data.user);
    return data.user;
  }

  function stripAuthParamsFromUrl() {
    const params = new URLSearchParams(global.location.search);
    if (!params.has('auth_code') && !params.has('auth_error')) return;
    params.delete('auth_code');
    params.delete('auth_error');
    const q = params.toString();
    const hash = global.location.hash || '';
    history.replaceState({}, '', `${location.pathname}${q ? `?${q}` : ''}${hash}`);
  }

  function resolveAuthError(authError) {
    if (!authError) return null;
    return AUTH_ERRORS[authError] || AUTH_ERRORS.exchange_failed;
  }

  /**
   * URL の auth_code / auth_error を処理し、既存セッションを検証する。
   * @returns {Promise<{user: object|null, error: string|null, redirected: boolean}>}
   */
  async function bootstrapAuth(options) {
    const opts = options || {};
    const params = new URLSearchParams(global.location.search);
    const authCode = params.get('auth_code');
    const authError = params.get('auth_error');

    if (authError) {
      clearSession();
      const message = resolveAuthError(authError);
      stripAuthParamsFromUrl();
      return { user: null, error: message, redirected: false, source: 'error' };
    }

    if (authCode) {
      try {
        const user = await exchangeAuthCode(authCode);
        stripAuthParamsFromUrl();
        const ret = consumeAuthReturn();
        if (ret && user && opts.allowRedirect !== false) {
          global.location.replace(ret);
          return { user, error: null, redirected: true, source: 'exchange' };
        }
        return { user, error: null, redirected: false, source: 'exchange' };
      } catch (e) {
        console.warn('[auth] exchange failed', e);
        stripAuthParamsFromUrl();
        let message = AUTH_ERRORS.exchange_failed;
        if (e && (e.code === 'api_config_missing' || e.code === 'api_config_not_allowed' || e.code === 'api_config_invalid')) {
          message = e.message || AUTH_ERRORS.api_config_invalid;
        } else if (e && e.status === 403) {
          message = AUTH_ERRORS.not_allowed;
        }
        return { user: null, error: message, redirected: false, source: 'error' };
      }
    }

    if (getSessionToken()) {
      try {
        const user = await refreshSession();
        return { user, error: null, redirected: false, source: 'refresh' };
      } catch (e) {
        if (e && (e.code === 'api_config_missing' || e.code === 'api_config_not_allowed' || e.code === 'api_config_invalid')) {
          return { user: null, error: e.message || AUTH_ERRORS.api_config_invalid, redirected: false, source: 'error' };
        }
        if (e && (e.status === 401 || e.status === 403)) {
          clearSession();
          const message = e.status === 403 ? AUTH_ERRORS.revoked : AUTH_ERRORS.session_invalid;
          return { user: null, error: message, redirected: false, source: 'error' };
        }
        console.warn('[auth] refresh failed (session kept)', e);
        const cached = getSessionUser();
        if (cached) {
          return { user: cached, error: null, redirected: false, source: 'cache', offline: true };
        }
        return { user: null, error: null, redirected: false, source: null };
      }
    }

    return { user: null, error: null, redirected: false, source: null };
  }

  const api = {
    get SESSION_KEY() {
      return SESSION_KEY();
    },
    get USER_KEY() {
      return USER_KEY();
    },
    get AUTH_RETURN_KEY() {
      return AUTH_RETURN_KEY();
    },
    AUTH_ERRORS,
    SESSION_INVALID_MESSAGE: AUTH_ERRORS.session_invalid,
    getApiBase,
    getSessionToken,
    getSessionUser,
    setSession,
    clearSession,
    cookiePath,
    setAuthReturn,
    clearAuthReturn,
    readAuthReturn,
    consumeAuthReturn,
    getDisplayName,
    isLabAdmin,
    apiFetch,
    loginWithGoogle,
    exchangeAuthCode,
    refreshSession,
    bootstrapAuth,
    resolveAuthError,
    stripAuthParamsFromUrl,
    apiMode,
  };

  global.TaRaboAuth = api;

  global.getApiBase = getApiBase;
  global.getSessionToken = getSessionToken;
  global.getSessionUser = getSessionUser;
  global.setSession = setSession;
  global.clearSession = clearSession;
  global.apiFetch = apiFetch;
  global.getDisplayName = getDisplayName;
  global.isLabAdmin = isLabAdmin;
  global.loginWithGoogle = function () {
    loginWithGoogle(defaultNextPage());
  };
  global.exchangeAuthCode = exchangeAuthCode;
  global.cookiePathAuth = cookiePath;
  global.readAuthReturn = readAuthReturn;
  global.clearAuthReturn = clearAuthReturn;
  global.consumeAuthReturn = consumeAuthReturn;
})(window);
