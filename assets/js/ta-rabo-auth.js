/* ta_rabo — Google ログイン / localStorage セッション（全ページ共通） */
(function (global) {
  const SESSION_KEY = 'ta_rabo_session_token';
  const USER_KEY = 'ta_rabo_session_user';
  const AUTH_RETURN_KEY = 'ta_rabo_auth_return';
  const ALLOWED_RETURN = new Set([
    'index.html',
    'lab_manager.html',
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
  };

  function getApiBase() {
    return String(global.TA_RABO_API_BASE || 'https://ta-rabo-works.vercel.app').replace(/\/$/, '');
  }

  function getSessionToken() {
    try {
      return localStorage.getItem(SESSION_KEY) || '';
    } catch (_) {
      return '';
    }
  }

  function getSessionUser() {
    try {
      return JSON.parse(localStorage.getItem(USER_KEY) || 'null');
    } catch (_) {
      return null;
    }
  }

  function setSession(token, user) {
    try {
      localStorage.setItem(SESSION_KEY, token);
      localStorage.setItem(USER_KEY, JSON.stringify(user));
    } catch (e) {
      console.warn('[auth] setSession failed', e);
    }
  }

  function clearSession() {
    try {
      localStorage.removeItem(SESSION_KEY);
      localStorage.removeItem(USER_KEY);
    } catch (_) {}
  }

  function cookiePath() {
    return location.pathname.includes('/ta-rabo-works') ? '/ta-rabo-works/' : '/';
  }

  function setAuthReturn(page) {
    if (!ALLOWED_RETURN.has(page)) return;
    try {
      localStorage.setItem(AUTH_RETURN_KEY, page);
    } catch (_) {}
    try {
      sessionStorage.setItem(AUTH_RETURN_KEY, page);
    } catch (_) {}
    try {
      document.cookie = `${AUTH_RETURN_KEY}=${encodeURIComponent(page)}; path=${cookiePath()}; max-age=900; SameSite=Lax`;
    } catch (_) {}
  }

  function clearAuthReturn() {
    try {
      localStorage.removeItem(AUTH_RETURN_KEY);
    } catch (_) {}
    try {
      sessionStorage.removeItem(AUTH_RETURN_KEY);
    } catch (_) {}
    try {
      document.cookie = `${AUTH_RETURN_KEY}=; path=${cookiePath()}; max-age=0; SameSite=Lax`;
      document.cookie = `${AUTH_RETURN_KEY}=; path=/; max-age=0; SameSite=Lax`;
    } catch (_) {}
  }

  function readAuthReturn() {
    const ok = (v) => ALLOWED_RETURN.has(v) && v !== 'lab_manager.html' && v !== 'index.html';
    try {
      const a = localStorage.getItem(AUTH_RETURN_KEY);
      if (ok(a)) return a;
    } catch (_) {}
    try {
      const b = sessionStorage.getItem(AUTH_RETURN_KEY);
      if (ok(b)) return b;
    } catch (_) {}
    try {
      const m = document.cookie.match(/(?:^|;\s*)ta_rabo_auth_return=([^;]+)/);
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

  async function apiFetch(path, options) {
    const opts = options || {};
    const headers = { ...(opts.headers || {}) };
    if (!headers['Content-Type'] && opts.body) headers['Content-Type'] = 'application/json';
    const token = getSessionToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${getApiBase()}${path}`, { ...opts, headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || `API error ${res.status}`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  function loginWithGoogle(nextPage) {
    const next = ALLOWED_RETURN.has(nextPage) ? nextPage : 'lab_manager.html';
    setAuthReturn(next);
    global.location.href = `${getApiBase()}/api/auth/google?next=${encodeURIComponent(next)}`;
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
        const message =
          e && e.status === 403 ? AUTH_ERRORS.not_allowed : AUTH_ERRORS.exchange_failed;
        return { user: null, error: message, redirected: false, source: 'error' };
      }
    }

    if (getSessionToken()) {
      try {
        const user = await refreshSession();
        return { user, error: null, redirected: false, source: 'refresh' };
      } catch (e) {
        if (e && (e.status === 401 || e.status === 403)) {
          clearSession();
          const message = e.status === 403 ? AUTH_ERRORS.revoked : null;
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
    SESSION_KEY,
    USER_KEY,
    AUTH_RETURN_KEY,
    AUTH_ERRORS,
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
  };

  global.TaRaboAuth = api;

  // lab_manager.html 互換（既存 inline スクリプト向け）
  global.getApiBase = getApiBase;
  global.getSessionToken = getSessionToken;
  global.getSessionUser = getSessionUser;
  global.setSession = setSession;
  global.clearSession = clearSession;
  global.apiFetch = apiFetch;
  global.getDisplayName = getDisplayName;
  global.isLabAdmin = isLabAdmin;
  global.loginWithGoogle = function () {
    loginWithGoogle('lab_manager.html');
  };
  global.exchangeAuthCode = exchangeAuthCode;
  global.cookiePathAuth = cookiePath;
  global.readAuthReturn = readAuthReturn;
  global.clearAuthReturn = clearAuthReturn;
  global.consumeAuthReturn = consumeAuthReturn;
})(window);
