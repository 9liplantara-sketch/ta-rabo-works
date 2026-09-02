/**
 * v3 stable item-ID sync hash（GAS SyncHashV3.gs と同仕様 — verify で一致を検証）
 */
import { createHash } from 'node:crypto';

export const V3_STABLE_HASH_VERSION = 'itemid-v1';
export const V3_STABLE_HASH_PREFIX = `${V3_STABLE_HASH_VERSION}:`;
export const V3_QUESTIONNAIRE_VERSION = 'member-analysis-2026-v3';
export const V3_STABLE_HASH_ITEM_COUNT = 118;

/** @param {string} storedHash */
export function isStableV3StoredHash(storedHash) {
  return String(storedHash || '').startsWith(V3_STABLE_HASH_PREFIX);
}

/** @param {string} digest 64-char hex */
export function formatStableV3StoredHash(digest) {
  return V3_STABLE_HASH_PREFIX + digest;
}

/** @param {string} storedHash */
export function extractStableV3Digest(storedHash) {
  if (!isStableV3StoredHash(storedHash)) return null;
  return String(storedHash).slice(V3_STABLE_HASH_PREFIX.length);
}

/** @param {string} prefix */
export function truncateHashForLog(prefix) {
  const s = String(prefix || '');
  if (!s) return '';
  return s.length <= 8 ? s : `${s.slice(0, 8)}…`;
}

/**
 * JSON hash 用の決定論的 value 正規化（scoring とは別責務）
 * @param {unknown} value
 */
export function canonicalizeHashValue(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalizeHashValue);
  if (typeof value === 'object') {
    /** @type {Record<string, unknown>} */
    const out = {};
    Object.keys(value).sort().forEach((k) => {
      out[k] = canonicalizeHashValue(value[k]);
    });
    return out;
  }
  return String(value);
}

/**
 * @param {string} questionnaireVersion
 * @param {Array<{ item_id?: string, question_version?: string }>} mappingRows active 118
 * @param {Record<string, unknown>} itemAnswers
 */
export function buildStableV3HashPayload(questionnaireVersion, mappingRows, itemAnswers) {
  const answers = mappingRows
    .map((row) => {
      const itemId = String(row.item_id || '').trim();
      return {
        item_id: itemId,
        question_version: String(row.question_version || '').trim(),
        value: canonicalizeHashValue(itemAnswers[itemId]),
      };
    })
    .filter((a) => a.item_id)
    .sort((a, b) => a.item_id.localeCompare(b.item_id));

  return {
    hash_version: V3_STABLE_HASH_VERSION,
    questionnaire_version: questionnaireVersion,
    answers,
  };
}

/** @param {string} text */
export function sha256HexUtf8(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * @param {string} questionnaireVersion
 * @param {Array<{ item_id?: string, question_version?: string }>} mappingRows
 * @param {Record<string, unknown>} itemAnswers
 */
export function computeStableV3ResponseHash(questionnaireVersion, mappingRows, itemAnswers) {
  const payload = buildStableV3HashPayload(questionnaireVersion, mappingRows, itemAnswers);
  const json = JSON.stringify(payload);
  return formatStableV3StoredHash(sha256HexUtf8(json));
}

/**
 * v3 compatibility bridge — GAS evaluateSyncNeedV3_ と同仕様
 * @param {{
 *   syncId?: string,
 *   status?: string,
 *   storedHash?: string,
 *   legacyHash?: string,
 *   stableHash?: string,
 * }} input
 */
export function evaluateSyncNeedV3(input) {
  const syncId = String(input.syncId || '').trim();
  const status = String(input.status || '').trim();
  const storedHash = String(input.storedHash || '').trim();
  const legacyHash = String(input.legacyHash || '').trim();
  const stableHash = String(input.stableHash || '').trim();

  if (!syncId) {
    return {
      needsSync: true,
      assignSyncId: true,
      reason: 'new',
      hashToWrite: stableHash,
      hashFormat: 'stable',
    };
  }

  if (status !== 'synced') {
    return {
      needsSync: true,
      reason: status === 'error' ? 'retry_error' : 'not_synced',
      hashToWrite: stableHash,
      hashFormat: isStableV3StoredHash(storedHash) ? 'stable' : 'legacy',
    };
  }

  if (isStableV3StoredHash(storedHash)) {
    if (storedHash === stableHash) {
      return {
        needsSync: false,
        reason: 'unchanged',
        hashToWrite: stableHash,
        hashFormat: 'stable',
      };
    }
    return {
      needsSync: true,
      reason: 'changed',
      hashToWrite: stableHash,
      hashFormat: 'stable',
    };
  }

  if (storedHash && storedHash === legacyHash) {
    return {
      needsSync: false,
      reason: 'legacy_compatible_unchanged',
      hashToWrite: stableHash,
      hashFormat: 'legacy',
      legacyCompatible: true,
    };
  }

  return {
    needsSync: true,
    reason: storedHash ? 'changed' : 'changed',
    hashToWrite: stableHash,
    hashFormat: storedHash ? 'legacy' : 'missing',
  };
}

/**
 * @param {string} storedHash
 * @param {string} legacyHash
 * @param {string} stableHash
 */
export function classifyV3StoredHashFormat(storedHash, legacyHash, stableHash) {
  const stored = String(storedHash || '').trim();
  if (!stored) return 'missing';
  if (isStableV3StoredHash(stored)) return 'stable';
  if (stored === legacyHash) return 'legacy_compatible';
  return 'legacy_mismatch';
}
