/**
 * v3 stable item-ID sync hash（lib/member-analysis-sync-hash-v3.js と同仕様）
 *
 * 変更時は Node verify:member-analysis-phase4-stable-hash を必ず実行すること。
 */

var V3_STABLE_HASH_VERSION = 'itemid-v1';
var V3_STABLE_HASH_PREFIX = V3_STABLE_HASH_VERSION + ':';

function isStableV3StoredHash_(storedHash) {
  return String(storedHash || '').indexOf(V3_STABLE_HASH_PREFIX) === 0;
}

function truncateHashForLog_(hash) {
  var s = String(hash || '');
  if (!s) return '';
  return s.length <= 8 ? s : s.substring(0, 8) + '\u2026';
}

function canonicalizeHashValueV3_(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return value;
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return Utilities.formatDate(value, Session.getScriptTimeZone() || 'Asia/Tokyo', "yyyy-MM-dd'T'HH:mm:ssXXX");
  }
  if (Object.prototype.toString.call(value) === '[object Array]') {
    return value.map(function (v) { return canonicalizeHashValueV3_(v); });
  }
  if (typeof value === 'object') {
    var keys = Object.keys(value).sort();
    var out = {};
    keys.forEach(function (k) { out[k] = canonicalizeHashValueV3_(value[k]); });
    return out;
  }
  return String(value);
}

function buildStableV3HashPayload_(questionnaireVersion, mappingRows, itemAnswers) {
  var sorted = mappingRows.slice().sort(function (a, b) {
    return String(a.item_id || '').localeCompare(String(b.item_id || ''));
  });
  var answers = sorted.map(function (row) {
    var itemId = String(row.item_id || '').trim();
    return {
      item_id: itemId,
      question_version: String(row.question_version || '').trim(),
      value: canonicalizeHashValueV3_(itemAnswers[itemId]),
    };
  }).filter(function (a) { return a.item_id; });

  return {
    hash_version: V3_STABLE_HASH_VERSION,
    questionnaire_version: questionnaireVersion,
    answers: answers,
  };
}

function computeStableV3ResponseHash_(questionnaireVersion, mappingRows, itemAnswers) {
  var payload = buildStableV3HashPayload_(questionnaireVersion, mappingRows, itemAnswers);
  var json = JSON.stringify(payload);
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, json, Utilities.Charset.UTF_8);
  var hex = digest.map(function (b) {
    var v = (b < 0 ? b + 256 : b).toString(16);
    return v.length === 1 ? '0' + v : v;
  }).join('');
  return V3_STABLE_HASH_PREFIX + hex;
}

/**
 * v3 evaluateSyncNeed bridge（legacy dual-read / stable-write）
 * @returns {{ needsSync: boolean, syncId?: string, newHash: string, legacyHash: string, stableHash: string, reason: string, assignSyncId?: boolean, hashFormat?: string, legacyCompatible?: boolean }}
 */
function evaluateSyncNeedV3_(syncId, status, storedHash, legacyHash, stableHash) {
  var id = String(syncId || '').trim();
  var st = String(status || '').trim();
  var stored = String(storedHash || '').trim();
  var legacy = String(legacyHash || '').trim();
  var stable = String(stableHash || '').trim();

  if (!id) {
    id = Utilities.getUuid();
    return {
      needsSync: true,
      syncId: id,
      newHash: stable,
      legacyHash: legacy,
      stableHash: stable,
      reason: 'new',
      assignSyncId: true,
      hashFormat: 'stable',
    };
  }

  if (st !== SYNC_STATUS_SYNCED) {
    return {
      needsSync: true,
      syncId: id,
      newHash: stable,
      legacyHash: legacy,
      stableHash: stable,
      reason: st === SYNC_STATUS_ERROR ? 'retry_error' : 'not_synced',
      hashFormat: isStableV3StoredHash_(stored) ? 'stable' : 'legacy',
    };
  }

  if (isStableV3StoredHash_(stored)) {
    if (stored === stable) {
      return {
        needsSync: false,
        syncId: id,
        newHash: stable,
        legacyHash: legacy,
        stableHash: stable,
        reason: 'unchanged',
        hashFormat: 'stable',
      };
    }
    return {
      needsSync: true,
      syncId: id,
      newHash: stable,
      legacyHash: legacy,
      stableHash: stable,
      reason: 'changed',
      hashFormat: 'stable',
    };
  }

  if (stored && stored === legacy) {
    return {
      needsSync: false,
      syncId: id,
      newHash: stable,
      legacyHash: legacy,
      stableHash: stable,
      reason: 'legacy_compatible_unchanged',
      hashFormat: 'legacy',
      legacyCompatible: true,
    };
  }

  return {
    needsSync: true,
    syncId: id,
    newHash: stable,
    legacyHash: legacy,
    stableHash: stable,
    reason: stored ? 'changed' : 'changed',
    hashFormat: stored ? 'legacy' : 'missing',
  };
}
