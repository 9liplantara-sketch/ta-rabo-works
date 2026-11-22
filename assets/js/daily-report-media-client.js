/**
 * 日報の直接画像アップロード（クライアント）
 * - canvas で縮小（UX）。最終的な向き・メタ除去・寸法はサーバー sharp が正とする
 * - 送信は raw binary（Base64 不使用）。Vercel 4.5MiB ボディ上限内に収める
 * - Object URL キャッシュはセッション／mediaId 単位。ログアウト等で破棄
 */
(function (global) {
  'use strict';

  // サーバー MEDIA_LIMITS と一致させること（api / lib/daily-report-media.js）
  const LIMITS = {
    maxFilesPerReport: 12,
    maxBytes: Math.floor(3.5 * 1024 * 1024),
    maxEdgePx: 2400,
    thumbEdgePx: 480,
    jpegQuality: 0.82,
    thumbQuality: 0.72,
    vercelBodyLimitBytes: Math.floor(4.5 * 1024 * 1024),
  };

  const HEIC_HINT =
    'この端末の HEIC/HEIF はそのままでは保存できません。写真アプリで JPEG に書き出するか、カメラロールから選ぶと JPEG になることが多いです。';

  /** @type {Map<string, string>} cacheKey → objectURL */
  const blobUrlCache = new Map();
  let cacheSessionKey = '';

  function currentSessionKey() {
    try {
      const user = typeof global.getSessionUser === 'function' ? global.getSessionUser() : null;
      if (!user) return '';
      return String(user.studentId || user.id || user.email || '');
    } catch (_) {
      return '';
    }
  }

  function ensureSessionCacheScope() {
    const sk = currentSessionKey();
    if (sk !== cacheSessionKey) {
      clearBlobUrlCache();
      cacheSessionKey = sk;
    }
    return sk;
  }

  function cacheKeyFor(mediaId, variant) {
    const sk = ensureSessionCacheScope();
    if (!sk) return null;
    return `${sk}|${mediaId}|${variant || 'full'}`;
  }

  function clearBlobUrlCache() {
    for (const url of blobUrlCache.values()) {
      try { URL.revokeObjectURL(url); } catch (_) { /* ignore */ }
    }
    blobUrlCache.clear();
  }

  function invalidateMedia(mediaId) {
    if (!mediaId) return;
    const prefix = `|${mediaId}|`;
    for (const [key, url] of [...blobUrlCache.entries()]) {
      if (key.includes(prefix) || key.endsWith(`|${mediaId}|full`) || key.endsWith(`|${mediaId}|thumb`)) {
        try { URL.revokeObjectURL(url); } catch (_) { /* ignore */ }
        blobUrlCache.delete(key);
      }
    }
    // より確実: キー形式 sk|id|variant
    for (const [key, url] of [...blobUrlCache.entries()]) {
      const parts = key.split('|');
      if (parts[1] === String(mediaId)) {
        try { URL.revokeObjectURL(url); } catch (_) { /* ignore */ }
        blobUrlCache.delete(key);
      }
    }
  }

  function isHeicFile(file) {
    const name = String(file?.name || '').toLowerCase();
    const type = String(file?.type || '').toLowerCase();
    return type.includes('heic') || type.includes('heif')
      || /\.heic$/i.test(name) || /\.heif$/i.test(name);
  }

  function randomUploadKey() {
    if (global.crypto && crypto.randomUUID) return crypto.randomUUID();
    return `uk-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function loadImageElement(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('画像を読み込めませんでした'));
      };
      img.src = url;
    });
  }

  async function drawToBlob(source, { maxEdge, mime, quality }) {
    let w = source.naturalWidth || source.width;
    let h = source.naturalHeight || source.height;
    if (!w || !h) throw new Error('画像サイズを取得できませんでした');

    const scale = Math.min(1, maxEdge / Math.max(w, h));
    const tw = Math.max(1, Math.round(w * scale));
    const th = Math.max(1, Math.round(h * scale));

    const canvas = document.createElement('canvas');
    canvas.width = tw;
    canvas.height = th;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(source, 0, 0, tw, th);

    const outMime = mime === 'image/png' ? 'image/png'
      : mime === 'image/webp' ? 'image/webp'
        : 'image/jpeg';
    const blob = await new Promise((resolve) => {
      canvas.toBlob((b) => resolve(b), outMime, quality);
    });
    if (!blob) throw new Error('画像の圧縮に失敗しました');
    return { blob, width: tw, height: th, contentType: outMime };
  }

  async function prepareFile(file) {
    if (!file) throw new Error('ファイルがありません');
    if (isHeicFile(file)) {
      const err = new Error(HEIC_HINT);
      err.code = 'heic_unsupported';
      throw err;
    }

    let bitmap = null;
    let imgEl = null;
    try {
      if (typeof createImageBitmap === 'function') {
        try {
          bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
        } catch (_) {
          bitmap = await createImageBitmap(file);
        }
      }
    } catch (_) {
      bitmap = null;
    }
    if (!bitmap) {
      imgEl = await loadImageElement(file);
    }

    const source = bitmap || imgEl;
    const srcType = String(file.type || '').toLowerCase();
    const preferPng = srcType === 'image/png';
    const preferWebp = srcType === 'image/webp';
    const mime = preferPng ? 'image/png' : preferWebp ? 'image/webp' : 'image/jpeg';

    let full = await drawToBlob(source, {
      maxEdge: LIMITS.maxEdgePx,
      mime,
      quality: LIMITS.jpegQuality,
    });

    if (full.blob.size > LIMITS.maxBytes) {
      full = await drawToBlob(source, {
        maxEdge: Math.min(LIMITS.maxEdgePx, 1600),
        mime: 'image/jpeg',
        quality: 0.72,
      });
    }
    if (full.blob.size > LIMITS.maxBytes) {
      const err = new Error(`画像は ${(LIMITS.maxBytes / (1024 * 1024)).toFixed(1)}MB 以下にしてください`);
      err.code = 'too_large';
      throw err;
    }

    if (bitmap && bitmap.close) bitmap.close();

    const previewUrl = URL.createObjectURL(full.blob);
    return {
      blob: full.blob,
      width: full.width,
      height: full.height,
      contentType: full.contentType,
      filename: file.name || 'photo.jpg',
      clientUploadKey: randomUploadKey(),
      previewUrl,
    };
  }

  /**
   * raw binary POST（Content-Type: image/*）。サムネはサーバー生成。
   */
  async function uploadPrepared(prepared, { caption } = {}) {
    const getToken = global.getSessionToken;
    const getBase = global.getApiBase;
    if (typeof getToken !== 'function' || typeof getBase !== 'function') {
      throw new Error('認証ヘルパーが未読み込みです');
    }
    const token = getToken();
    if (!token) throw new Error('ログインが必要です');

    if (prepared.blob.size > LIMITS.maxBytes) {
      const err = new Error(`画像は ${(LIMITS.maxBytes / (1024 * 1024)).toFixed(1)}MB 以下にしてください`);
      err.code = 'too_large';
      throw err;
    }

    const url = `${getBase()}/api/daily-reports?resource=media`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': prepared.contentType || 'image/jpeg',
        'X-Client-Upload-Key': prepared.clientUploadKey || '',
        'X-Filename': encodeURIComponent(prepared.filename || 'photo.jpg'),
        'X-Caption': encodeURIComponent(caption || ''),
      },
      body: prepared.blob,
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || `アップロードに失敗しました (${res.status})`);
      err.status = res.status;
      err.code = data.code || null;
      err.data = data;
      throw err;
    }
    return data.media;
  }

  async function fetchAuthorizedBlob(mediaId, variant) {
    const sk = ensureSessionCacheScope();
    if (!sk) throw new Error('ログインが必要です');

    const key = cacheKeyFor(mediaId, variant);
    if (key && blobUrlCache.has(key)) {
      return blobUrlCache.get(key);
    }

    const getToken = global.getSessionToken;
    const getBase = global.getApiBase;
    if (typeof getToken !== 'function' || typeof getBase !== 'function') {
      throw new Error('認証ヘルパーが未読み込みです');
    }
    const token = getToken();
    if (!token) throw new Error('ログインが必要です');

    const url = `${getBase()}/api/daily-reports?resource=media&id=${encodeURIComponent(mediaId)}&variant=${encodeURIComponent(variant || 'full')}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Cache-Control': 'no-cache',
      },
      cache: 'no-store',
    });
    if (!res.ok) {
      invalidateMedia(mediaId);
      const err = new Error(`画像取得に失敗しました (${res.status})`);
      err.status = res.status;
      throw err;
    }
    // 取得後にもセッションが変わっていないか確認
    if (currentSessionKey() !== sk) {
      clearBlobUrlCache();
      throw new Error('セッションが切り替わったため画像を表示できません');
    }
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    if (key) blobUrlCache.set(key, objectUrl);
    return objectUrl;
  }

  function revokePreview(url) {
    if (url && String(url).startsWith('blob:')) {
      try { URL.revokeObjectURL(url); } catch (_) { /* ignore */ }
    }
  }

  function hookAuthLifecycle() {
    const wrap = (name) => {
      const orig = global[name];
      if (typeof orig !== 'function' || orig.__dailyReportMediaHooked) return;
      const wrapped = function hookedAuth(...args) {
        if (name === 'clearSession') {
          clearBlobUrlCache();
          cacheSessionKey = '';
        } else if (name === 'setSession') {
          // アカウント切替: 新旧でキーが変わればクリア
          const prev = cacheSessionKey;
          const result = orig.apply(this, args);
          const next = currentSessionKey();
          if (prev && next && prev !== next) clearBlobUrlCache();
          if (!next) clearBlobUrlCache();
          cacheSessionKey = next;
          return result;
        }
        return orig.apply(this, args);
      };
      wrapped.__dailyReportMediaHooked = true;
      global[name] = wrapped;
      if (global.TaRaboAuth && typeof global.TaRaboAuth[name] === 'function') {
        global.TaRaboAuth[name] = wrapped;
      }
    };
    wrap('clearSession');
    wrap('setSession');

    try {
      global.addEventListener('ta-rabo:session-invalidated', () => {
        clearBlobUrlCache();
        cacheSessionKey = '';
      });
      global.addEventListener('ta-rabo:session-invalid', () => {
        clearBlobUrlCache();
        cacheSessionKey = '';
      });
    } catch (_) { /* ignore */ }
  }

  hookAuthLifecycle();

  global.DailyReportMedia = {
    LIMITS,
    HEIC_HINT,
    isHeicFile,
    prepareFile,
    uploadPrepared,
    fetchAuthorizedBlob,
    revokePreview,
    clearBlobUrlCache,
    invalidateMedia,
  };
})(typeof window !== 'undefined' ? window : globalThis);
