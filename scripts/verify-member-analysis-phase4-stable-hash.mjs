#!/usr/bin/env node
/**
 * Phase 4 — v3 stable item-ID sync hash + legacy compatibility bridge
 *
 *   npm run verify:member-analysis-phase4-stable-hash
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  candidateAnswerHeadersForMappingRow,
  filterActiveMappedRows,
} from '../lib/member-analysis-item-answers.js';
import { parseGoogleFormMappingCsv } from '../lib/member-analysis-v3-form-mapping.js';
import { buildGasEquivalentV3ItemAnswers } from '../lib/member-analysis-v3-scoring-fixture.js';
import { evaluateSyncNeed } from '../lib/member-analysis-gas-sync-logic.js';
import {
  buildStableV3HashPayload,
  classifyV3StoredHashFormat,
  computeStableV3ResponseHash,
  evaluateSyncNeedV3,
  isStableV3StoredHash,
  sha256HexUtf8,
  V3_QUESTIONNAIRE_VERSION,
  V3_STABLE_HASH_ITEM_COUNT,
  V3_STABLE_HASH_PREFIX,
} from '../lib/member-analysis-sync-hash-v3.js';
import {
  buildSyntheticFilteredRawAnswers,
} from '../lib/member-analysis-fixture-scoring.js';
import {
  computeResponseContentHash,
  filterRawAnswersForSync,
} from '../lib/member-analysis-sheet-headers.js';
import { MEMBER_ANALYSIS_QUESTIONNAIRE_V1 } from '../lib/member-analysis-questionnaire-v1.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mappingPath = path.join(__dirname, '../test/fixtures/member-analysis-v3-google-form-mapping-final.csv');
const gasCodePath = path.join(__dirname, '../gas/member-analysis-sync/Code.gs');
const syncHashGasPath = path.join(__dirname, '../gas/member-analysis-sync/SyncHashV3.gs');

let passed = 0;
let failed = 0;

function assert(cond, label) {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}`);
  }
}

function assertEqual(actual, expected, label) {
  assert(actual === expected, `${label} (${JSON.stringify(actual)} === ${JSON.stringify(expected)})`);
}

const mappingRows = parseGoogleFormMappingCsv(fs.readFileSync(mappingPath, 'utf8'), {
  excludeOrphans: false,
});
const active = filterActiveMappedRows(mappingRows);
assert(active.length === 118, 'fixture active mapping 118');

/** @type {Record<string, unknown>} */
const syntheticRaw = {};
for (const row of active) {
  const candidates = candidateAnswerHeadersForMappingRow(row);
  syntheticRaw[candidates[0]] = `answer:${row.item_id}`;
}

/** hash テスト用 item_answers（Form label 形式・118件） */
const itemAnswers = buildGasEquivalentV3ItemAnswers();
assertEqual(Object.keys(itemAnswers).length, 118, 'item_answers 118 keys');

const legacyHash = computeResponseContentHash(syntheticRaw);
const stableHash = computeStableV3ResponseHash(V3_QUESTIONNAIRE_VERSION, active, itemAnswers);

console.log('\n=== Phase 4: stable hash canonical payload ===\n');

const payload = buildStableV3HashPayload(V3_QUESTIONNAIRE_VERSION, active, itemAnswers);
assertEqual(payload.hash_version, 'itemid-v1', 'hash_version');
assertEqual(payload.questionnaire_version, V3_QUESTIONNAIRE_VERSION, 'questionnaire_version');
assertEqual(payload.answers.length, V3_STABLE_HASH_ITEM_COUNT, 'answers count 118');
for (let i = 1; i < payload.answers.length; i += 1) {
  assert(
    payload.answers[i - 1].item_id.localeCompare(payload.answers[i].item_id) <= 0,
    `answers sorted at index ${i}`,
  );
}
assert(
  !payload.answers.some((a) => Object.prototype.hasOwnProperty.call(a, 'source_header')),
  'payload excludes source_header',
);
assert(
  payload.answers.every((a) => a.question_version === '2026_v1'),
  'all question_version 2026_v1 in fixture',
);
assert(isStableV3StoredHash(stableHash), 'stable hash has itemid-v1 prefix');
assertEqual(stableHash.split(':').length, 2, 'stable hash single colon separator');
assertEqual(stableHash.slice(V3_STABLE_HASH_PREFIX.length).length, 64, 'stable digest 64 hex');

console.log('\n=== Phase 4: mapping order invariance ===\n');

const shuffled = active.slice().sort(() => (Math.random() > 0.5 ? 1 : -1));
const stableShuffled = computeStableV3ResponseHash(V3_QUESTIONNAIRE_VERSION, shuffled, itemAnswers);
assertEqual(stableHash, stableShuffled, 'stable hash invariant to mapping row order');

console.log('\n=== Phase 4: header rename regression ===\n');

const renamedMapping = active.map((row) => ({
  ...row,
  source_header: `RENAMED::${row.source_header}`,
}));
const stableRenamed = computeStableV3ResponseHash(V3_QUESTIONNAIRE_VERSION, renamedMapping, itemAnswers);
assertEqual(stableHash, stableRenamed, 'stable hash unchanged when only source_header renamed');

const rawRenamed = { ...syntheticRaw };
const firstHeader = Object.keys(syntheticRaw)[0];
rawRenamed[`RENAMED_HEADER::${firstHeader}`] = rawRenamed[firstHeader];
delete rawRenamed[firstHeader];
const legacyRenamed = computeResponseContentHash(rawRenamed);
assert(legacyRenamed !== legacyHash, 'legacy hash changes when Sheet header renamed');

console.log('\n=== Phase 4: semantic answer change ===\n');

const changedAnswers = { ...itemAnswers, 'B5-E1': '6：かなり当てはまる' };
const stableChanged = computeStableV3ResponseHash(V3_QUESTIONNAIRE_VERSION, active, changedAnswers);
assert(stableChanged !== stableHash, 'stable hash changes on B5-E1 label change');
const bridgeChanged = evaluateSyncNeedV3({
  syncId: 'id-1',
  status: 'synced',
  storedHash: stableHash,
  legacyHash,
  stableHash: stableChanged,
});
assert(bridgeChanged.needsSync, 'stable stored + answer change → needsSync');

console.log('\n=== Phase 4: question_version change ===\n');

const qvMapping = active.map((row) => (
  row.item_id === 'B5-E1' ? { ...row, question_version: '2026_v2' } : row
));
const stableQv = computeStableV3ResponseHash(V3_QUESTIONNAIRE_VERSION, qvMapping, itemAnswers);
assert(stableQv !== stableHash, 'stable hash changes when question_version changes');

console.log('\n=== Phase 4: non-scoring answer change ===\n');

const futChanged = { ...itemAnswers, 'INT-01': 'changed free text answer' };
const stableFut = computeStableV3ResponseHash(V3_QUESTIONNAIRE_VERSION, active, futChanged);
assert(stableFut !== stableHash, 'stable hash changes on INT-01 change');

console.log('\n=== Phase 4: v3 compatibility bridge ===\n');

const legacyUnchanged = evaluateSyncNeedV3({
  syncId: 'row-5',
  status: 'synced',
  storedHash: legacyHash,
  legacyHash,
  stableHash,
});
assert(!legacyUnchanged.needsSync, 'legacy stored + unchanged → needsSync false');
assert(legacyUnchanged.legacyCompatible, 'legacy compatible flag');
assertEqual(legacyUnchanged.reason, 'legacy_compatible_unchanged', 'legacy compatible reason');

const stableUnchanged = evaluateSyncNeedV3({
  syncId: 'row-5',
  status: 'synced',
  storedHash: stableHash,
  legacyHash,
  stableHash,
});
assert(!stableUnchanged.needsSync, 'stable stored + unchanged → needsSync false');

const legacyChanged = evaluateSyncNeedV3({
  syncId: 'row-5',
  status: 'synced',
  storedHash: 'deadbeef'.repeat(8),
  legacyHash,
  stableHash,
});
assert(legacyChanged.needsSync, 'legacy stored mismatch → needsSync true');
assertEqual(legacyChanged.hashToWrite, stableHash, 'changed sync writes stable hash');

const errorRetry = evaluateSyncNeedV3({
  syncId: 'row-5',
  status: 'error',
  storedHash: legacyHash,
  legacyHash,
  stableHash,
});
assert(errorRetry.needsSync, 'error status retries even if legacy hash matches');

const newRow = evaluateSyncNeedV3({
  syncId: '',
  status: '',
  storedHash: '',
  legacyHash,
  stableHash,
});
assert(newRow.needsSync, 'new row needsSync');
assert(newRow.assignSyncId, 'new row assigns sync id');
assertEqual(newRow.hashToWrite, stableHash, 'new row writes stable hash');

console.log('\n=== Phase 4: mass resync prevention (4 legacy synced rows) ===\n');

for (let i = 0; i < 4; i += 1) {
  const rowDecision = evaluateSyncNeedV3({
    syncId: `sync-id-${i}`,
    status: 'synced',
    storedHash: legacyHash,
    legacyHash,
    stableHash,
  });
  assert(!rowDecision.needsSync, `legacy synced row ${i + 1} unchanged → no resync`);
}

console.log('\n=== Phase 4: v1 legacy hash frozen ===\n');

const v1Filtered = filterRawAnswersForSync(buildSyntheticFilteredRawAnswers());
const v1Hash = computeResponseContentHash(v1Filtered);
assertEqual(v1Hash.length, 64, 'v1 legacy hash 64 hex');
assert(!isStableV3StoredHash(v1Hash), 'v1 hash has no itemid prefix');

const v1Unchanged = evaluateSyncNeed({
  syncId: 'v1-id',
  status: 'synced',
  storedHash: v1Hash,
  newHash: v1Hash,
});
assert(!v1Unchanged.needsSync, 'v1 synced unchanged');

const v1Error = evaluateSyncNeed({
  syncId: 'v1-id',
  status: 'error',
  storedHash: v1Hash,
  newHash: v1Hash,
});
assert(v1Error.needsSync, 'v1 error retries');

console.log('\n=== Phase 4: GAS fixture parity (74 string labels) ===\n');

assert(isStableV3StoredHash(stableHash), 'GAS fixture stable hash format');

console.log('\n=== Phase 4: stored hash classification ===\n');

assertEqual(classifyV3StoredHashFormat(stableHash, legacyHash, stableHash), 'stable', 'classify stable');
assertEqual(classifyV3StoredHashFormat(legacyHash, legacyHash, stableHash), 'legacy_compatible', 'classify legacy compatible');
assertEqual(classifyV3StoredHashFormat('', legacyHash, stableHash), 'missing', 'classify missing');
assertEqual(classifyV3StoredHashFormat('abc', legacyHash, stableHash), 'legacy_mismatch', 'classify legacy mismatch');

console.log('\n=== Phase 4: deterministic JSON / sha256 ===\n');

const payloadJson = JSON.stringify(payload);
const digest = sha256HexUtf8(payloadJson);
assertEqual(stableHash, `${V3_STABLE_HASH_PREFIX}${digest}`, 'stable hash digest matches payload JSON');

console.log('\n=== Phase 4: GAS source checks ===\n');

const gasCode = fs.readFileSync(gasCodePath, 'utf8');
const syncHashGas = fs.readFileSync(syncHashGasPath, 'utf8');

assert(gasCode.includes('evaluateSyncNeedV3_'), 'Code.gs uses evaluateSyncNeedV3_');
assert(gasCode.includes('computeStableV3ResponseHash_'), 'Code.gs references stable hash');
assert(gasCode.includes('previewMemberAnalysisV3SyncHashMigration'), 'hash audit function present');
assert(gasCode.includes('mappingRowsForHash'), 'sync core loads mapping once for hash');
assert(!gasCode.includes('member_analysis_sync_hash_version'), 'no new hash version column');

const evalBlock = gasCode.slice(gasCode.indexOf('function evaluateSyncNeed_'), gasCode.indexOf('function buildResponseMap_'));
assert(evalBlock.includes('QUESTIONNAIRE_VERSION_V3'), 'evaluateSyncNeed_ branches on v3');
assert(evalBlock.includes('computeResponseHash_'), 'v1 path still uses legacy hash');

assert(syncHashGas.includes("V3_STABLE_HASH_PREFIX = V3_STABLE_HASH_VERSION + ':'"), 'SyncHashV3.gs prefix');
assert(syncHashGas.includes('legacy_compatible_unchanged'), 'SyncHashV3.gs legacy bridge');

const previewStart = gasCode.indexOf('function buildMemberAnalysisV3SyncPayloadPreviewStats_');
const previewEnd = gasCode.indexOf('function previewMemberAnalysisAnnualConfig');
const previewBlock = gasCode.slice(
  previewStart,
  previewEnd > previewStart ? previewEnd : previewStart + 8000,
);
assert(previewBlock.includes('hash_mode'), 'preview includes hash_mode');
assert(!previewBlock.includes('UrlFetchApp.fetch'), 'preview remains read-only');

console.log(`\n=== Phase 4 stable hash: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed ? 1 : 0);
