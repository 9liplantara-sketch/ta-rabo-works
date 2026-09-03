/**
 * Phase 5E — Dual Schema / Historical Response Guard
 *
 * response_schema_version は questionnaire_version / academic_year /
 * scoring_version とは独立。物理 Sheet layout 世代を明示する。
 *
 * - legacy-physical-v1: Form 編集前の historical snapshot（現行 header で再解釈禁止）
 * - semantic-itemid-v3: 恒久 item_id Mapping で解釈可能な現行 response
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RESPONSE_SCHEMA_LEGACY_PHYSICAL_V1 = 'legacy-physical-v1';
export const RESPONSE_SCHEMA_SEMANTIC_ITEMID_V3 = 'semantic-itemid-v3';

/**
 * Phase 5E Production E2E — controlled single-row semantic resync target.
 * sync_id 明示のみ（row 番号・timestamp 禁止）。
 */
export const PHASE5E_CONTROLLED_SEMANTIC_SYNC_ID =
  'bfc6feeb-25e4-4b64-9dcf-232c2f83c0a6';

export const PHASE5E_CONTROLLED_ACADEMIC_YEAR = 2026;
export const PHASE5E_CONTROLLED_QUESTIONNAIRE_VERSION = 'member-analysis-2026-v3';
export const PHASE5E_CONTROLLED_MAPPING_ACTIVE = 118;

export const RESPONSE_SCHEMA_VERSIONS = [
  RESPONSE_SCHEMA_LEGACY_PHYSICAL_V1,
  RESPONSE_SCHEMA_SEMANTIC_ITEMID_V3,
];

export const SOURCE_LAYOUT_HASH_PREFIX = 'sheet-layout-v1:';

/** Sheet sync metadata（layout fingerprint / raw_answers から除外） */
export const RESPONSE_SCHEMA_SYNC_COLUMN_HEADERS = [
  'member_analysis_response_schema',
  'member_analysis_source_layout_hash',
];

export const MEMBER_ANALYSIS_SYNC_METADATA_PREFIX = 'member_analysis_';

export const SCORING_VERSION_V1 = 'member-analysis-score-v1';
export const SCORING_VERSION_V3 = 'member-analysis-score-v3';

export const PSYCH_SOURCE_GOOGLE_FORMS_SHEET = 'google_forms_sheet';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_BOOTSTRAP_PATH = join(
  __dirname,
  '../test/fixtures/member-analysis-2026-response-schema-bootstrap.json',
);

/**
 * @param {unknown} raw
 * @returns {{ ok: true, value: string } | { ok: false, error: string }}
 */
export function parseResponseSchemaVersion(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return { ok: false, error: 'response_schema_version is required' };
  }
  const value = String(raw).trim();
  if (!RESPONSE_SCHEMA_VERSIONS.includes(value)) {
    return { ok: false, error: `unsupported response_schema_version: ${value}` };
  }
  return { ok: true, value };
}

/**
 * @param {unknown} raw
 * @returns {{ ok: true, value: string|null } | { ok: false, error: string }}
 */
export function parseOptionalResponseSchemaVersion(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return { ok: true, value: null };
  }
  return parseResponseSchemaVersion(raw);
}

/**
 * @param {unknown} raw
 * @returns {{ ok: true, value: string } | { ok: false, error: string }}
 */
export function parseSourceLayoutHash(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return { ok: false, error: 'source_layout_hash is required' };
  }
  const value = String(raw).trim();
  if (!value.startsWith(SOURCE_LAYOUT_HASH_PREFIX)) {
    return { ok: false, error: 'source_layout_hash must use sheet-layout-v1: prefix' };
  }
  const digest = value.slice(SOURCE_LAYOUT_HASH_PREFIX.length);
  if (!/^[0-9a-f]{64}$/.test(digest)) {
    return { ok: false, error: 'source_layout_hash digest must be 64-char hex' };
  }
  return { ok: true, value };
}

/**
 * @param {unknown} raw
 * @returns {{ ok: true, value: string|null } | { ok: false, error: string }}
 */
export function parseOptionalSourceLayoutHash(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return { ok: true, value: null };
  }
  return parseSourceLayoutHash(raw);
}

/**
 * Form 回答由来 header のみ（member_analysis_* 除外）。順序を保持。
 * @param {unknown[]} headers row-1 headers in column order
 * @returns {{ index: number, header: string }[]}
 */
export function extractFormAnswerHeaderSequence(headers) {
  const out = [];
  (headers || []).forEach((h, idx) => {
    const header = String(h ?? '').trim();
    if (!header) return;
    if (header.startsWith(MEMBER_ANALYSIS_SYNC_METADATA_PREFIX)) return;
    out.push({ index: idx + 1, header });
  });
  return out;
}

/**
 * Canonical layout fingerprint.
 * @param {unknown[]} headers
 * @returns {string} sheet-layout-v1:<sha256>
 */
export function computeSourceLayoutHash(headers) {
  const sequence = extractFormAnswerHeaderSequence(headers);
  const canonical = sequence.map((row) => `${row.index}\t${row.header}`).join('\n');
  const digest = createHash('sha256').update(canonical, 'utf8').digest('hex');
  return SOURCE_LAYOUT_HASH_PREFIX + digest;
}

/**
 * DB upsert: NULL→fill / same OK / different FAIL CLOSED
 * @param {unknown} existing
 * @param {unknown} incoming
 */
export function assertResponseSchemaUpsertAllowed(existing, incoming) {
  const existingParsed = parseOptionalResponseSchemaVersion(existing);
  if (!existingParsed.ok) return existingParsed;
  const incomingParsed = parseResponseSchemaVersion(incoming);
  if (!incomingParsed.ok) return incomingParsed;

  if (existingParsed.value == null) {
    return { ok: true, value: incomingParsed.value };
  }
  if (existingParsed.value === incomingParsed.value) {
    return { ok: true, value: existingParsed.value };
  }
  return {
    ok: false,
    error: `response_schema_version mismatch: existing=${existingParsed.value} incoming=${incomingParsed.value}`,
  };
}

/**
 * @param {unknown} existing
 * @param {unknown} incoming
 */
export function assertSourceLayoutUpsertAllowed(existing, incoming) {
  const existingParsed = parseOptionalSourceLayoutHash(existing);
  if (!existingParsed.ok) return existingParsed;
  const incomingParsed = parseSourceLayoutHash(incoming);
  if (!incomingParsed.ok) return incomingParsed;

  if (existingParsed.value == null) {
    return { ok: true, value: incomingParsed.value };
  }
  if (existingParsed.value === incomingParsed.value) {
    return { ok: true, value: existingParsed.value };
  }
  return {
    ok: false,
    error: 'source_layout_changed',
  };
}

/**
 * Phase 5E controlled semantic resync gate（1 sync_id のみ・hash unchanged でも送信可）
 *
 * @param {{
 *   syncEnabled?: unknown,
 *   targetSyncId?: string,
 *   sheetRows?: Array<{ syncId?: unknown, responseSchema?: unknown, storedLayoutHash?: unknown }>,
 *   currentLayoutHash?: string,
 *   questionnaireVersion?: unknown,
 *   academicYear?: unknown,
 *   mappingActiveCount?: unknown,
 *   mappingUnresolvedCount?: unknown,
 *   mappingDuplicateCount?: unknown,
 * }} input
 */
export function evaluatePhase5EControlledSemanticResync(input = {}) {
  const targetSyncId = String(
    input.targetSyncId || PHASE5E_CONTROLLED_SEMANTIC_SYNC_ID,
  ).trim();
  const syncEnabledRaw = String(input.syncEnabled ?? '').trim().toLowerCase();
  const syncEnabled = syncEnabledRaw === 'true' || syncEnabledRaw === '1';

  if (!syncEnabled) {
    return { ok: false, reason: 'sync_disabled', candidateCount: 0 };
  }

  if (String(input.questionnaireVersion || '').trim() !== PHASE5E_CONTROLLED_QUESTIONNAIRE_VERSION) {
    return { ok: false, reason: 'questionnaire_version_mismatch', candidateCount: 0 };
  }

  if (Number(input.academicYear) !== PHASE5E_CONTROLLED_ACADEMIC_YEAR) {
    return { ok: false, reason: 'academic_year_mismatch', candidateCount: 0 };
  }

  const mappingActive = Number(input.mappingActiveCount);
  const mappingUnresolved = Number(input.mappingUnresolvedCount);
  const mappingDuplicate = Number(input.mappingDuplicateCount);
  if (
    mappingActive !== PHASE5E_CONTROLLED_MAPPING_ACTIVE
    || mappingUnresolved !== 0
    || mappingDuplicate !== 0
  ) {
    return { ok: false, reason: 'mapping_invalid', candidateCount: 0 };
  }

  const currentLayout = String(input.currentLayoutHash || '').trim();
  if (!currentLayout) {
    return { ok: false, reason: 'source_layout_hash_missing', candidateCount: 0 };
  }

  const matches = (input.sheetRows || []).filter(
    (row) => String(row?.syncId || '').trim() === targetSyncId,
  );
  if (matches.length === 0) {
    return { ok: false, reason: 'target_sync_id_not_found', candidateCount: 0 };
  }
  if (matches.length > 1) {
    return { ok: false, reason: 'duplicate_target_sync_id', candidateCount: matches.length };
  }

  const row = matches[0];
  const schema = String(row.responseSchema || '').trim();
  if (schema === RESPONSE_SCHEMA_LEGACY_PHYSICAL_V1) {
    return { ok: false, reason: 'legacy_schema_frozen', candidateCount: 0 };
  }
  if (schema !== RESPONSE_SCHEMA_SEMANTIC_ITEMID_V3) {
    return { ok: false, reason: 'schema_not_semantic', candidateCount: 0 };
  }

  const storedLayout = String(row.storedLayoutHash || '').trim();
  if (!storedLayout || storedLayout !== currentLayout) {
    return { ok: false, reason: 'source_layout_changed', candidateCount: 0 };
  }

  // Exact target only — never expand to other rows
  return {
    ok: true,
    reason: 'phase5e_controlled_resync',
    candidateCount: 1,
    targetSyncId,
    allowSendDespiteUnchangedHash: true,
    responseSchemaToSend: RESPONSE_SCHEMA_SEMANTIC_ITEMID_V3,
    layoutHashToSend: currentLayout,
  };
}

/**
 * Sheet sync gate（row 番号・timestamp では分岐しない）
 * @param {{
 *   responseSchema?: unknown,
 *   storedLayoutHash?: unknown,
 *   currentLayoutHash?: string,
 *   syncId?: unknown,
 *   forceAll?: boolean,
 * }} input
 * @returns {{
 *   action: 'skip'|'reject'|'proceed',
 *   reason: string,
 *   needsSync: boolean,
 *   responseSchemaToSend?: string|null,
 *   layoutHashToSend?: string|null,
 *   writeSchemaOnSuccess?: boolean,
 * }}
 */
export function evaluateResponseSchemaSyncGate(input = {}) {
  const schemaRaw = String(input.responseSchema || '').trim();
  const storedLayout = String(input.storedLayoutHash || '').trim();
  const currentLayout = String(input.currentLayoutHash || '').trim();
  const syncId = String(input.syncId || '').trim();
  const forceAll = !!input.forceAll;

  if (schemaRaw === RESPONSE_SCHEMA_LEGACY_PHYSICAL_V1) {
    return {
      action: 'skip',
      reason: 'legacy_schema_frozen',
      needsSync: false,
      responseSchemaToSend: null,
      layoutHashToSend: null,
      writeSchemaOnSuccess: false,
      forceAllIgnored: forceAll,
    };
  }

  if (schemaRaw === RESPONSE_SCHEMA_SEMANTIC_ITEMID_V3) {
    if (!storedLayout) {
      return {
        action: 'reject',
        reason: 'source_layout_hash_missing',
        needsSync: false,
        responseSchemaToSend: null,
        layoutHashToSend: null,
        writeSchemaOnSuccess: false,
      };
    }
    if (!currentLayout || storedLayout !== currentLayout) {
      return {
        action: 'reject',
        reason: 'source_layout_changed',
        needsSync: false,
        responseSchemaToSend: null,
        layoutHashToSend: null,
        writeSchemaOnSuccess: false,
      };
    }
    return {
      action: 'proceed',
      reason: 'semantic_layout_ok',
      // hash / status による最終 needsSync は caller（evaluateSyncNeedV3）が決定
      needsSync: null,
      responseSchemaToSend: RESPONSE_SCHEMA_SEMANTIC_ITEMID_V3,
      layoutHashToSend: currentLayout,
      writeSchemaOnSuccess: false,
    };
  }

  if (schemaRaw) {
    return {
      action: 'reject',
      reason: 'unsupported_response_schema',
      needsSync: false,
      responseSchemaToSend: null,
      layoutHashToSend: null,
      writeSchemaOnSuccess: false,
    };
  }

  // unclassified
  if (syncId) {
    return {
      action: 'skip',
      reason: 'unclassified_response_schema',
      needsSync: false,
      responseSchemaToSend: null,
      layoutHashToSend: null,
      writeSchemaOnSuccess: false,
      forceAllIgnored: forceAll,
    };
  }

  if (!currentLayout) {
    return {
      action: 'reject',
      reason: 'source_layout_hash_missing',
      needsSync: false,
      responseSchemaToSend: null,
      layoutHashToSend: null,
      writeSchemaOnSuccess: false,
    };
  }

  return {
    action: 'proceed',
    reason: 'new_semantic_candidate',
    needsSync: true,
    responseSchemaToSend: RESPONSE_SCHEMA_SEMANTIC_ITEMID_V3,
    layoutHashToSend: currentLayout,
    writeSchemaOnSuccess: true,
  };
}

/**
 * Read path compatibility metadata（v1/v3 を同一尺度として比較しない）
 * @param {{ response_schema_version?: unknown, scoring_version?: unknown }} row
 */
export function describeAssessmentDataMode(row = {}) {
  const schema = String(row.response_schema_version || '').trim();
  const scoring = String(row.scoring_version || '').trim();

  if (schema === RESPONSE_SCHEMA_LEGACY_PHYSICAL_V1 || scoring === SCORING_VERSION_V1) {
    return {
      dataMode: 'legacy',
      rawAnswerSemantics: 'historical-untrusted-headers',
      response_schema_version: schema || RESPONSE_SCHEMA_LEGACY_PHYSICAL_V1,
    };
  }

  if (schema === RESPONSE_SCHEMA_SEMANTIC_ITEMID_V3 || scoring === SCORING_VERSION_V3) {
    return {
      dataMode: 'semantic-v3',
      rawAnswerSemantics: 'stable-item-id',
      response_schema_version: schema || RESPONSE_SCHEMA_SEMANTIC_ITEMID_V3,
    };
  }

  return {
    dataMode: 'unknown',
    rawAnswerSemantics: 'unknown',
    response_schema_version: schema || null,
  };
}

/**
 * @param {string} [fixturePath]
 * @returns {{
 *   [RESPONSE_SCHEMA_LEGACY_PHYSICAL_V1]: string[],
 *   [RESPONSE_SCHEMA_SEMANTIC_ITEMID_V3]: string[],
 * }}
 */
export function loadResponseSchemaBootstrapManifest(fixturePath = DEFAULT_BOOTSTRAP_PATH) {
  const raw = JSON.parse(readFileSync(fixturePath, 'utf8'));
  const legacy = Array.isArray(raw[RESPONSE_SCHEMA_LEGACY_PHYSICAL_V1])
    ? raw[RESPONSE_SCHEMA_LEGACY_PHYSICAL_V1].map((id) => String(id).trim()).filter(Boolean)
    : [];
  const semantic = Array.isArray(raw[RESPONSE_SCHEMA_SEMANTIC_ITEMID_V3])
    ? raw[RESPONSE_SCHEMA_SEMANTIC_ITEMID_V3].map((id) => String(id).trim()).filter(Boolean)
    : [];
  return {
    [RESPONSE_SCHEMA_LEGACY_PHYSICAL_V1]: legacy,
    [RESPONSE_SCHEMA_SEMANTIC_ITEMID_V3]: semantic,
  };
}

/**
 * Manifest lookup only（row 番号・日付は使わない）
 * @param {string} syncId
 * @param {ReturnType<typeof loadResponseSchemaBootstrapManifest>} manifest
 */
export function lookupBootstrapSchemaForSyncId(syncId, manifest) {
  const id = String(syncId || '').trim();
  if (!id || !manifest) return null;
  if ((manifest[RESPONSE_SCHEMA_LEGACY_PHYSICAL_V1] || []).includes(id)) {
    return RESPONSE_SCHEMA_LEGACY_PHYSICAL_V1;
  }
  if ((manifest[RESPONSE_SCHEMA_SEMANTIC_ITEMID_V3] || []).includes(id)) {
    return RESPONSE_SCHEMA_SEMANTIC_ITEMID_V3;
  }
  return null;
}

/**
 * Sheet audit（PII なし件数）
 * @param {{
 *   rows: Array<{
 *     syncId?: string,
 *     responseSchema?: string,
 *     sourceLayoutHash?: string,
 *   }>,
 *   currentLayoutHash: string,
 *   manifest?: ReturnType<typeof loadResponseSchemaBootstrapManifest>,
 * }} input
 */
export function evaluateResponseSchemaSheetAudit(input) {
  const rows = input.rows || [];
  const currentLayoutHash = String(input.currentLayoutHash || '').trim();
  const manifest = input.manifest || null;

  const stats = {
    response_rows: rows.length,
    legacy_schema_rows: 0,
    semantic_v3_rows: 0,
    unclassified_rows: 0,
    schema_conflicts: 0,
    layout_hash: currentLayoutHash || null,
    layout_mismatches: 0,
    would_bootstrap: 0,
    validation: 'PASS',
    reason: null,
    warnings: /** @type {string[]} */ ([]),
    errors: /** @type {string[]} */ ([]),
  };

  for (const row of rows) {
    const schema = String(row.responseSchema || '').trim();
    const storedLayout = String(row.sourceLayoutHash || '').trim();
    const syncId = String(row.syncId || '').trim();
    const bootstrapSchema = manifest ? lookupBootstrapSchemaForSyncId(syncId, manifest) : null;

    if (schema === RESPONSE_SCHEMA_LEGACY_PHYSICAL_V1) {
      stats.legacy_schema_rows += 1;
      if (bootstrapSchema && bootstrapSchema !== schema) {
        stats.schema_conflicts += 1;
        stats.errors.push('schema_conflict_legacy');
      }
    } else if (schema === RESPONSE_SCHEMA_SEMANTIC_ITEMID_V3) {
      stats.semantic_v3_rows += 1;
      if (bootstrapSchema && bootstrapSchema !== schema) {
        stats.schema_conflicts += 1;
        stats.errors.push('schema_conflict_semantic');
      }
      if (storedLayout && currentLayoutHash && storedLayout !== currentLayoutHash) {
        stats.layout_mismatches += 1;
      }
    } else if (schema) {
      stats.schema_conflicts += 1;
      stats.errors.push('unsupported_schema');
    } else {
      stats.unclassified_rows += 1;
      if (bootstrapSchema) stats.would_bootstrap += 1;
    }
  }

  if (stats.schema_conflicts > 0) {
    stats.validation = 'FAIL';
    stats.reason = 'schema_conflicts';
  } else if (stats.layout_mismatches > 0) {
    stats.validation = 'FAIL';
    stats.reason = 'source_layout_changed';
  } else if (stats.unclassified_rows > 0 && stats.would_bootstrap > 0) {
    stats.validation = 'WARN';
    stats.reason = 'bootstrap_pending';
    stats.warnings.push('unclassified_rows_need_bootstrap');
  } else if (stats.unclassified_rows > 0) {
    stats.validation = 'WARN';
    stats.reason = 'unclassified_rows';
    stats.warnings.push('unclassified_rows_present');
  }

  return stats;
}

/**
 * Sheet one-time bootstrap write plan（sync_id manifest のみ）
 * legacy には layout hash を書かない。semantic のみ current layout を初回保存。
 *
 * @param {{
 *   syncId?: unknown,
 *   existingSchema?: unknown,
 *   existingLayoutHash?: unknown,
 *   currentLayoutHash?: string,
 *   manifest: ReturnType<typeof loadResponseSchemaBootstrapManifest>,
 * }} input
 * @returns {{
 *   action: 'skip'|'write',
 *   reason: string,
 *   responseSchema?: string,
 *   writeLayoutHash?: boolean,
 *   sourceLayoutHash?: string|null,
 * }}
 */
export function planResponseSchemaBootstrapWrite(input) {
  const syncId = String(input.syncId || '').trim();
  const existingSchema = String(input.existingSchema || '').trim();
  const existingLayout = String(input.existingLayoutHash || '').trim();
  const currentLayout = String(input.currentLayoutHash || '').trim();
  const bootstrapSchema = lookupBootstrapSchemaForSyncId(syncId, input.manifest);

  if (!bootstrapSchema) {
    return { action: 'skip', reason: 'not_in_manifest' };
  }
  if (existingSchema) {
    return { action: 'skip', reason: 'already_set', responseSchema: existingSchema };
  }

  if (bootstrapSchema === RESPONSE_SCHEMA_LEGACY_PHYSICAL_V1) {
    return {
      action: 'write',
      reason: 'bootstrap_legacy',
      responseSchema: RESPONSE_SCHEMA_LEGACY_PHYSICAL_V1,
      writeLayoutHash: false,
      sourceLayoutHash: null,
    };
  }

  if (bootstrapSchema === RESPONSE_SCHEMA_SEMANTIC_ITEMID_V3) {
    return {
      action: 'write',
      reason: 'bootstrap_semantic',
      responseSchema: RESPONSE_SCHEMA_SEMANTIC_ITEMID_V3,
      writeLayoutHash: !existingLayout,
      sourceLayoutHash: existingLayout || currentLayout || null,
    };
  }

  return { action: 'skip', reason: 'unsupported_bootstrap_schema' };
}

/**
 * DB migration guard helpers（apply script / tests）
 * @param {{
 *   source?: string,
 *   source_response_id?: string,
 *   scoring_version?: string,
 *   item_answers?: unknown,
 *   response_schema_version?: unknown,
 * }} row
 */
export function canBackfillLegacyPhysicalV1(row) {
  if (String(row.source || '') !== PSYCH_SOURCE_GOOGLE_FORMS_SHEET) return false;
  if (String(row.scoring_version || '') !== SCORING_VERSION_V1) return false;
  if (row.response_schema_version != null && String(row.response_schema_version).trim() !== '') {
    return false;
  }
  return countItemAnswerKeys(row.item_answers) === 0;
}

/**
 * @param {{
 *   source?: string,
 *   source_response_id?: string,
 *   scoring_version?: string,
 *   item_answers?: unknown,
 *   response_schema_version?: unknown,
 * }} row
 */
export function canBackfillSemanticItemidV3(row) {
  if (String(row.source || '') !== PSYCH_SOURCE_GOOGLE_FORMS_SHEET) return false;
  if (String(row.scoring_version || '') !== SCORING_VERSION_V3) return false;
  if (row.response_schema_version != null && String(row.response_schema_version).trim() !== '') {
    return false;
  }
  return countItemAnswerKeys(row.item_answers) === 118;
}

/** @param {unknown} itemAnswers */
export function countItemAnswerKeys(itemAnswers) {
  if (itemAnswers == null) return 0;
  if (typeof itemAnswers === 'string') {
    try {
      return countItemAnswerKeys(JSON.parse(itemAnswers));
    } catch {
      return 0;
    }
  }
  if (typeof itemAnswers !== 'object' || Array.isArray(itemAnswers)) return 0;
  return Object.keys(itemAnswers).length;
}

/**
 * Sync payload validation for v3 semantic path
 * @param {unknown} item
 */
export function validateSemanticV3SchemaFields(item) {
  const schema = parseResponseSchemaVersion(item?.response_schema_version);
  if (!schema.ok) return schema;
  if (schema.value !== RESPONSE_SCHEMA_SEMANTIC_ITEMID_V3) {
    return {
      ok: false,
      error: `v3 sync requires response_schema_version=${RESPONSE_SCHEMA_SEMANTIC_ITEMID_V3}`,
    };
  }
  const layout = parseSourceLayoutHash(item?.source_layout_hash);
  if (!layout.ok) return layout;
  return {
    ok: true,
    value: {
      responseSchemaVersion: schema.value,
      sourceLayoutHash: layout.value,
    },
  };
}
