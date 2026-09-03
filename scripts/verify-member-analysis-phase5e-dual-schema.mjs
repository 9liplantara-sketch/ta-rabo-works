#!/usr/bin/env node
/**
 * Phase 5E — Dual Schema / Historical Response Guard
 *
 *   npm run verify:member-analysis-phase5e-dual-schema
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'node:crypto';
import {
  RESPONSE_SCHEMA_LEGACY_PHYSICAL_V1,
  RESPONSE_SCHEMA_SEMANTIC_ITEMID_V3,
  SOURCE_LAYOUT_HASH_PREFIX,
  SCORING_VERSION_V1,
  SCORING_VERSION_V3,
  assertResponseSchemaUpsertAllowed,
  assertSourceLayoutUpsertAllowed,
  canBackfillLegacyPhysicalV1,
  canBackfillSemanticItemidV3,
  computeSourceLayoutHash,
  describeAssessmentDataMode,
  evaluateResponseSchemaSheetAudit,
  evaluateResponseSchemaSyncGate,
  extractFormAnswerHeaderSequence,
  loadResponseSchemaBootstrapManifest,
  lookupBootstrapSchemaForSyncId,
  parseResponseSchemaVersion,
  planResponseSchemaBootstrapWrite,
  evaluatePhase5EControlledSemanticResync,
  PHASE5E_CONTROLLED_SEMANTIC_SYNC_ID,
  validateSemanticV3SchemaFields,
} from '../lib/member-analysis-response-schema.js';
import {
  validateSyncResponseForTest,
  mapPsychAssessmentForClient,
} from '../lib/psych-assessments.js';
import { QUESTIONNAIRE_VERSION_V3 } from '../lib/member-analysis-item-answers.js';
import { computeStableV3ResponseHash, V3_QUESTIONNAIRE_VERSION } from '../lib/member-analysis-sync-hash-v3.js';
import { evaluateSyncNeedV3 } from '../lib/member-analysis-sync-hash-v3.js';
import { MEMBER_ANALYSIS_QUESTIONNAIRE_V1 } from '../lib/member-analysis-questionnaire-v1.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const fixturePath = path.join(root, 'test/fixtures/member-analysis-2026-response-schema-bootstrap.json');
const migrationPath = path.join(root, 'db/migrations/2026-09-psych-assessments-response-schema.sql');
const gasPath = path.join(root, 'gas/member-analysis-sync/Code.gs');
const readmePath = path.join(root, 'gas/member-analysis-sync/README.md');

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

const LEGACY_IDS = [
  'c17c3da7-00e5-40f2-8947-faa77b94238a',
  'f675e458-7ac1-4c75-9cf8-523e676e614c',
  '4d890e1d-8c6a-4b45-8b16-cd823e2c768d',
];
const V3_ID = 'bfc6feeb-25e4-4b64-9dcf-232c2f83c0a6';

console.log('\n=== Phase 5E: constants / parse ===\n');

assert(parseResponseSchemaVersion(RESPONSE_SCHEMA_LEGACY_PHYSICAL_V1).ok, 'legacy schema parse');
assert(parseResponseSchemaVersion(RESPONSE_SCHEMA_SEMANTIC_ITEMID_V3).ok, 'semantic schema parse');
assert(!parseResponseSchemaVersion('').ok, 'blank schema invalid');
assert(!parseResponseSchemaVersion('other').ok, 'unknown schema invalid');

console.log('\n=== Phase 5E: layout hash canonical ===\n');

const headersA = ['タイムスタンプ', '氏名', '学籍番号', 'Q1', 'member_analysis_sync_id'];
const headersB = ['タイムスタンプ', '氏名', '学籍番号', 'Q1', 'member_analysis_sync_id', 'member_analysis_response_schema'];
const hashA = computeSourceLayoutHash(headersA);
const hashB = computeSourceLayoutHash(headersB);
assert(hashA.startsWith(SOURCE_LAYOUT_HASH_PREFIX), 'layout hash prefix');
assert(hashA === hashB, 'member_analysis_* excluded → same hash');

const seq = extractFormAnswerHeaderSequence(headersA);
assert(seq.length === 4, 'form answer headers exclude sync meta');
assert(seq[0].index === 1 && seq[0].header === 'タイムスタンプ', 'order preserved with column index');

const reordered = computeSourceLayoutHash(['氏名', 'タイムスタンプ', '学籍番号', 'Q1']);
assert(reordered !== hashA, 'header reorder changes layout hash');

const renamed = computeSourceLayoutHash(['タイムスタンプ', '氏名', '旧設問', 'Q1']);
assert(renamed !== hashA, 'header rename changes layout hash');

const inserted = computeSourceLayoutHash(['タイムスタンプ', '氏名', '学籍番号', 'NEW', 'Q1']);
assert(inserted !== hashA, 'column insertion changes layout hash');

const digestOnly = createHash('sha256')
  .update(['1\tタイムスタンプ', '2\t氏名', '3\t学籍番号', '4\tQ1'].join('\n'), 'utf8')
  .digest('hex');
assert(hashA === SOURCE_LAYOUT_HASH_PREFIX + digestOnly, 'canonical index\\theader\\n SHA-256');

console.log('\n=== Phase 5E: bootstrap manifest ===\n');

const manifest = loadResponseSchemaBootstrapManifest(fixturePath);
assert(manifest[RESPONSE_SCHEMA_LEGACY_PHYSICAL_V1].length === 3, 'manifest legacy 3');
assert(manifest[RESPONSE_SCHEMA_SEMANTIC_ITEMID_V3].length === 1, 'manifest semantic 1');
assert(
  LEGACY_IDS.every((id) => lookupBootstrapSchemaForSyncId(id, manifest) === RESPONSE_SCHEMA_LEGACY_PHYSICAL_V1),
  'legacy sync_ids map by id only',
);
assert(
  lookupBootstrapSchemaForSyncId(V3_ID, manifest) === RESPONSE_SCHEMA_SEMANTIC_ITEMID_V3,
  'v3 sync_id maps by id only',
);
assert(lookupBootstrapSchemaForSyncId('unknown', manifest) === null, 'unknown sync_id not classified');

console.log('\n=== Phase 5E: bootstrap plan (legacy no layout) ===\n');

const legacyPlan = planResponseSchemaBootstrapWrite({
  syncId: LEGACY_IDS[0],
  existingSchema: '',
  existingLayoutHash: '',
  currentLayoutHash: hashA,
  manifest,
});
assert(legacyPlan.action === 'write', 'legacy bootstrap writes schema');
assert(legacyPlan.responseSchema === RESPONSE_SCHEMA_LEGACY_PHYSICAL_V1, 'legacy schema value');
assert(legacyPlan.writeLayoutHash === false, 'legacy does NOT write layout hash');
assert(legacyPlan.sourceLayoutHash === null, 'legacy layout stays null');

const semanticPlan = planResponseSchemaBootstrapWrite({
  syncId: V3_ID,
  existingSchema: '',
  existingLayoutHash: '',
  currentLayoutHash: hashA,
  manifest,
});
assert(semanticPlan.action === 'write', 'semantic bootstrap writes');
assert(semanticPlan.responseSchema === RESPONSE_SCHEMA_SEMANTIC_ITEMID_V3, 'semantic schema value');
assert(semanticPlan.writeLayoutHash === true, 'semantic writes layout hash');
assert(semanticPlan.sourceLayoutHash === hashA, 'semantic layout = current');

const alreadySet = planResponseSchemaBootstrapWrite({
  syncId: LEGACY_IDS[0],
  existingSchema: RESPONSE_SCHEMA_LEGACY_PHYSICAL_V1,
  existingLayoutHash: '',
  currentLayoutHash: hashA,
  manifest,
});
assert(alreadySet.action === 'skip' && alreadySet.reason === 'already_set', 'bootstrap 2nd run skip');

const notManifest = planResponseSchemaBootstrapWrite({
  syncId: 'not-in-manifest',
  existingSchema: '',
  currentLayoutHash: hashA,
  manifest,
});
assert(notManifest.action === 'skip' && notManifest.reason === 'not_in_manifest', 'non-manifest sync_id skip');

console.log('\n=== Phase 5E: controlled semantic resync gate ===\n');

const baseControlled = {
  syncEnabled: true,
  questionnaireVersion: 'member-analysis-2026-v3',
  academicYear: 2026,
  mappingActiveCount: 118,
  mappingUnresolvedCount: 0,
  mappingDuplicateCount: 0,
  currentLayoutHash: hashA,
  sheetRows: [
    { syncId: LEGACY_IDS[0], responseSchema: RESPONSE_SCHEMA_LEGACY_PHYSICAL_V1, storedLayoutHash: '' },
    { syncId: LEGACY_IDS[1], responseSchema: RESPONSE_SCHEMA_LEGACY_PHYSICAL_V1, storedLayoutHash: '' },
    { syncId: LEGACY_IDS[2], responseSchema: RESPONSE_SCHEMA_LEGACY_PHYSICAL_V1, storedLayoutHash: '' },
    { syncId: V3_ID, responseSchema: RESPONSE_SCHEMA_SEMANTIC_ITEMID_V3, storedLayoutHash: hashA },
  ],
};

const controlledOk = evaluatePhase5EControlledSemanticResync(baseControlled);
assert(controlledOk.ok, 'exact sync_id semantic → allow');
assert(controlledOk.candidateCount === 1, 'exactly 1 candidate');
assert(controlledOk.targetSyncId === PHASE5E_CONTROLLED_SEMANTIC_SYNC_ID, 'target sync_id fixed');
assert(controlledOk.allowSendDespiteUnchangedHash === true, 'stable hash unchanged still allowed');
assert(controlledOk.layoutHashToSend === hashA, 'sends current layout hash');

assert(
  !evaluatePhase5EControlledSemanticResync({
    ...baseControlled,
    syncEnabled: false,
  }).ok,
  'SYNC_ENABLED=false → reject',
);
assert(
  evaluatePhase5EControlledSemanticResync({
    ...baseControlled,
    syncEnabled: false,
  }).reason === 'sync_disabled',
  'SYNC_ENABLED=false reason',
);

assert(
  !evaluatePhase5EControlledSemanticResync({
    ...baseControlled,
    sheetRows: baseControlled.sheetRows.map((r) =>
      (r.syncId === V3_ID
        ? { ...r, responseSchema: RESPONSE_SCHEMA_LEGACY_PHYSICAL_V1 }
        : r),
    ),
  }).ok,
  'legacy schema → reject',
);
assert(
  evaluatePhase5EControlledSemanticResync({
    ...baseControlled,
    sheetRows: baseControlled.sheetRows.map((r) =>
      (r.syncId === V3_ID
        ? { ...r, responseSchema: RESPONSE_SCHEMA_LEGACY_PHYSICAL_V1 }
        : r),
    ),
  }).reason === 'legacy_schema_frozen',
  'legacy reject reason',
);

assert(
  !evaluatePhase5EControlledSemanticResync({
    ...baseControlled,
    currentLayoutHash: renamed,
  }).ok,
  'wrong layout → reject',
);
assert(
  evaluatePhase5EControlledSemanticResync({
    ...baseControlled,
    currentLayoutHash: renamed,
  }).reason === 'source_layout_changed',
  'wrong layout reason',
);

assert(
  !evaluatePhase5EControlledSemanticResync({
    ...baseControlled,
    targetSyncId: LEGACY_IDS[0],
    sheetRows: baseControlled.sheetRows,
  }).ok,
  'non-target / legacy sync_id not sent as controlled semantic',
);

assert(
  evaluatePhase5EControlledSemanticResync({
    ...baseControlled,
    sheetRows: [
      ...baseControlled.sheetRows,
      { syncId: 'extra-id', responseSchema: RESPONSE_SCHEMA_SEMANTIC_ITEMID_V3, storedLayoutHash: hashA },
    ],
  }).candidateCount === 1,
  'extra semantic rows are not included — still 1 candidate',
);

const onlyExact = evaluatePhase5EControlledSemanticResync({
  ...baseControlled,
  sheetRows: [
    { syncId: V3_ID, responseSchema: RESPONSE_SCHEMA_SEMANTIC_ITEMID_V3, storedLayoutHash: hashA },
  ],
});
assert(onlyExact.ok && onlyExact.candidateCount === 1, 'exact sync_id only send');

console.log('\n=== Phase 5E: sync gate — legacy frozen ===\n');

const legacyGate = evaluateResponseSchemaSyncGate({
  responseSchema: RESPONSE_SCHEMA_LEGACY_PHYSICAL_V1,
  syncId: LEGACY_IDS[0],
  currentLayoutHash: hashA,
  forceAll: true,
});
assert(legacyGate.action === 'skip', 'legacy → skip');
assert(legacyGate.reason === 'legacy_schema_frozen', 'legacy reason');
assert(legacyGate.forceAllIgnored === true, 'forceAll does not unfreeze legacy');

console.log('\n=== Phase 5E: sync gate — semantic layout ===\n');

const semanticOk = evaluateResponseSchemaSyncGate({
  responseSchema: RESPONSE_SCHEMA_SEMANTIC_ITEMID_V3,
  storedLayoutHash: hashA,
  currentLayoutHash: hashA,
  syncId: V3_ID,
});
assert(semanticOk.action === 'proceed', 'same layout → proceed');
assert(semanticOk.responseSchemaToSend === RESPONSE_SCHEMA_SEMANTIC_ITEMID_V3, 'semantic schema to send');

const semanticChanged = evaluateResponseSchemaSyncGate({
  responseSchema: RESPONSE_SCHEMA_SEMANTIC_ITEMID_V3,
  storedLayoutHash: hashA,
  currentLayoutHash: renamed,
  syncId: V3_ID,
});
assert(semanticChanged.action === 'reject', 'layout change → reject');
assert(semanticChanged.reason === 'source_layout_changed', 'layout change reason');

const semanticMissingLayout = evaluateResponseSchemaSyncGate({
  responseSchema: RESPONSE_SCHEMA_SEMANTIC_ITEMID_V3,
  storedLayoutHash: '',
  currentLayoutHash: hashA,
  syncId: V3_ID,
});
assert(semanticMissingLayout.action === 'reject', 'missing stored layout → reject');
assert(semanticMissingLayout.reason === 'source_layout_hash_missing', 'missing layout reason');

console.log('\n=== Phase 5E: sync gate — unclassified / new ===\n');

const unclassified = evaluateResponseSchemaSyncGate({
  responseSchema: '',
  syncId: LEGACY_IDS[0],
  currentLayoutHash: hashA,
  forceAll: true,
});
assert(unclassified.action === 'skip', 'unclassified with sync_id → skip');
assert(unclassified.reason === 'unclassified_response_schema', 'unclassified reason');

const newRow = evaluateResponseSchemaSyncGate({
  responseSchema: '',
  syncId: '',
  currentLayoutHash: hashA,
});
assert(newRow.action === 'proceed', 'new row → semantic candidate');
assert(newRow.responseSchemaToSend === RESPONSE_SCHEMA_SEMANTIC_ITEMID_V3, 'new → semantic-itemid-v3');
assert(newRow.writeSchemaOnSuccess === true, 'new writes schema on success');

console.log('\n=== Phase 5E: API upsert guards ===\n');

assert(assertResponseSchemaUpsertAllowed(null, RESPONSE_SCHEMA_SEMANTIC_ITEMID_V3).ok, 'NULL→schema fill OK');
assert(
  assertResponseSchemaUpsertAllowed(RESPONSE_SCHEMA_SEMANTIC_ITEMID_V3, RESPONSE_SCHEMA_SEMANTIC_ITEMID_V3).ok,
  'same schema OK',
);
assert(
  !assertResponseSchemaUpsertAllowed(RESPONSE_SCHEMA_LEGACY_PHYSICAL_V1, RESPONSE_SCHEMA_SEMANTIC_ITEMID_V3).ok,
  'legacy→semantic mismatch FAIL',
);
assert(
  !assertResponseSchemaUpsertAllowed(RESPONSE_SCHEMA_SEMANTIC_ITEMID_V3, RESPONSE_SCHEMA_LEGACY_PHYSICAL_V1).ok,
  'semantic→legacy mismatch FAIL',
);

assert(assertSourceLayoutUpsertAllowed(null, hashA).ok, 'NULL→layout fill OK');
assert(assertSourceLayoutUpsertAllowed(hashA, hashA).ok, 'same layout OK');
assert(!assertSourceLayoutUpsertAllowed(hashA, renamed).ok, 'layout mismatch FAIL');
assert(
  assertSourceLayoutUpsertAllowed(hashA, renamed).error === 'source_layout_changed',
  'layout mismatch reason',
);

console.log('\n=== Phase 5E: validateSyncResponse semantic fields ===\n');

const v3Payload = {
  source_response_id: V3_ID,
  answered_at: '2026-01-15T10:00:00+09:00',
  respondent_name: 'SYNTHETIC',
  raw_answers: { 氏名: 'SYNTHETIC', Q1: '1' },
  item_answers: Object.fromEntries(
    Array.from({ length: 118 }, (_, i) => [`ITEM-${i}`, 3]),
  ),
  academic_year: 2026,
  response_schema_version: RESPONSE_SCHEMA_SEMANTIC_ITEMID_V3,
  source_layout_hash: hashA,
};
assert(
  validateSyncResponseForTest(v3Payload, { questionnaireVersion: QUESTIONNAIRE_VERSION_V3 }).ok,
  'v3 payload with schema+layout → PASS',
);

const missingSchema = { ...v3Payload };
delete missingSchema.response_schema_version;
assert(
  !validateSyncResponseForTest(missingSchema, { questionnaireVersion: QUESTIONNAIRE_VERSION_V3 }).ok,
  'v3 without schema → FAIL',
);

const legacyAsV3 = {
  ...v3Payload,
  response_schema_version: RESPONSE_SCHEMA_LEGACY_PHYSICAL_V1,
};
assert(
  !validateSyncResponseForTest(legacyAsV3, { questionnaireVersion: QUESTIONNAIRE_VERSION_V3 }).ok,
  'legacy schema on v3 questionnaire → FAIL',
);

assert(
  validateSemanticV3SchemaFields(v3Payload).ok,
  'validateSemanticV3SchemaFields PASS',
);

console.log('\n=== Phase 5E: read compatibility / no cross-scale ===\n');

const legacyMode = describeAssessmentDataMode({
  response_schema_version: RESPONSE_SCHEMA_LEGACY_PHYSICAL_V1,
  scoring_version: SCORING_VERSION_V1,
});
assert(legacyMode.dataMode === 'legacy', 'legacy dataMode');
assert(legacyMode.rawAnswerSemantics === 'historical-untrusted-headers', 'legacy raw semantics');

const semanticMode = describeAssessmentDataMode({
  response_schema_version: RESPONSE_SCHEMA_SEMANTIC_ITEMID_V3,
  scoring_version: SCORING_VERSION_V3,
});
assert(semanticMode.dataMode === 'semantic-v3', 'semantic dataMode');
assert(semanticMode.rawAnswerSemantics === 'stable-item-id', 'semantic raw semantics');

const clientLegacy = mapPsychAssessmentForClient({
  id: 'a',
  student_id: 's',
  respondent_name: 'x',
  answered_at: '2026-01-01',
  scores: { big5: {} },
  questionnaire_version: 'member-analysis-2026-v3',
  scoring_version: SCORING_VERSION_V1,
  response_schema_version: RESPONSE_SCHEMA_LEGACY_PHYSICAL_V1,
});
assert(clientLegacy.dataMode === 'legacy', 'client map legacy mode');
assert(clientLegacy.item_answers === undefined, 'client map does not invent item_answers');

console.log('\n=== Phase 5E: migration backfill guards ===\n');

assert(
  canBackfillLegacyPhysicalV1({
    source: 'google_forms_sheet',
    scoring_version: SCORING_VERSION_V1,
    item_answers: null,
  }),
  'legacy backfill allowed for score-v1 + empty item_answers',
);
assert(
  !canBackfillLegacyPhysicalV1({
    source: 'google_forms_sheet',
    scoring_version: SCORING_VERSION_V1,
    item_answers: { A: 1 },
  }),
  'legacy backfill blocked when item_answers has keys',
);
assert(
  canBackfillSemanticItemidV3({
    source: 'google_forms_sheet',
    scoring_version: SCORING_VERSION_V3,
    item_answers: Object.fromEntries(Array.from({ length: 118 }, (_, i) => [`k${i}`, 1])),
  }),
  'semantic backfill allowed for score-v3 + 118 keys',
);
assert(
  !canBackfillSemanticItemidV3({
    source: 'google_forms_sheet',
    scoring_version: SCORING_VERSION_V3,
    item_answers: { a: 1 },
  }),
  'semantic backfill blocked when not 118 keys',
);

console.log('\n=== Phase 5E: sheet audit + stable hash isolation ===\n');

const audit = evaluateResponseSchemaSheetAudit({
  currentLayoutHash: hashA,
  manifest,
  rows: [
    { syncId: LEGACY_IDS[0], responseSchema: '', sourceLayoutHash: '' },
    { syncId: LEGACY_IDS[1], responseSchema: '', sourceLayoutHash: '' },
    { syncId: LEGACY_IDS[2], responseSchema: '', sourceLayoutHash: '' },
    { syncId: V3_ID, responseSchema: '', sourceLayoutHash: '' },
  ],
});
assert(audit.would_bootstrap === 4, 'audit would_bootstrap=4');
assert(audit.unclassified_rows === 4, 'audit unclassified=4');
assert(audit.validation === 'WARN', 'audit WARN until bootstrap');

const auditBootstrapped = evaluateResponseSchemaSheetAudit({
  currentLayoutHash: hashA,
  manifest,
  rows: [
    { syncId: LEGACY_IDS[0], responseSchema: RESPONSE_SCHEMA_LEGACY_PHYSICAL_V1, sourceLayoutHash: '' },
    { syncId: LEGACY_IDS[1], responseSchema: RESPONSE_SCHEMA_LEGACY_PHYSICAL_V1, sourceLayoutHash: '' },
    { syncId: LEGACY_IDS[2], responseSchema: RESPONSE_SCHEMA_LEGACY_PHYSICAL_V1, sourceLayoutHash: '' },
    { syncId: V3_ID, responseSchema: RESPONSE_SCHEMA_SEMANTIC_ITEMID_V3, sourceLayoutHash: hashA },
  ],
});
assert(auditBootstrapped.legacy_schema_rows === 3, 'bootstrapped legacy=3');
assert(auditBootstrapped.semantic_v3_rows === 1, 'bootstrapped semantic=1');
assert(auditBootstrapped.layout_mismatches === 0, 'legacy empty layout is not a mismatch');
assert(auditBootstrapped.validation === 'PASS', 'bootstrapped audit PASS');

const mappingRows = Array.from({ length: 118 }, (_, i) => ({
  item_id: `ITM-${String(i).padStart(3, '0')}`,
  question_version: '2026_v1',
}));
const itemAnswers = Object.fromEntries(mappingRows.map((r) => [r.item_id, 3]));
const stable = computeStableV3ResponseHash(V3_QUESTIONNAIRE_VERSION, mappingRows, itemAnswers);
const stable2 = computeStableV3ResponseHash(V3_QUESTIONNAIRE_VERSION, mappingRows, itemAnswers);
assert(stable === stable2, 'stable hash unchanged by Phase 5E');
assert(!String(stable).includes('response_schema'), 'stable hash ignores schema fields');

const resyncOk = evaluateSyncNeedV3({
  syncId: V3_ID,
  status: 'synced',
  storedHash: stable,
  legacyHash: 'deadbeef',
  stableHash: stable,
});
assert(resyncOk.needsSync === false, 'same stable hash → normal resync not needed');

console.log('\n=== Phase 5E: migration / GAS / README markers ===\n');

const migrationSql = fs.readFileSync(migrationPath, 'utf8');
assert(migrationSql.includes('ADD COLUMN IF NOT EXISTS response_schema_version'), 'migration adds response_schema_version');
assert(migrationSql.includes('ADD COLUMN IF NOT EXISTS source_layout_hash'), 'migration adds source_layout_hash');
assert(migrationSql.includes("legacy-physical-v1"), 'migration backfills legacy');
assert(migrationSql.includes("semantic-itemid-v3"), 'migration backfills semantic');
assert(LEGACY_IDS.every((id) => migrationSql.includes(id)), 'migration lists legacy sync_ids');
assert(migrationSql.includes(V3_ID), 'migration lists v3 sync_id');
assert(migrationSql.includes('RAISE EXCEPTION'), 'migration fail-closed assert');
assert(migrationSql.includes('AND response_schema_version IS NULL'), 'UPDATE only fills NULL schema');
assert(migrationSql.includes('legacy_ok <> 3'), 'assert counts final state not UPDATE rowcount');
assert(!/GET DIAGNOSTICS|ROW_COUNT/i.test(migrationSql), 'no ROW_COUNT dependency');
assert(!/SET\s+source_layout_hash/i.test(migrationSql), 'migration does not set source_layout_hash');
assert(!/SET\s+student_id/i.test(migrationSql), 'migration does not touch student_id');
assert(!/SET\s+raw_answers/i.test(migrationSql), 'migration does not touch raw_answers');
assert(!/SET\s+item_answers/i.test(migrationSql), 'migration does not touch item_answers');
assert(!/SET\s+scores/i.test(migrationSql), 'migration does not touch scores');

const gasCode = fs.readFileSync(gasPath, 'utf8');
assert(gasCode.includes('previewMemberAnalysisResponseSchemas'), 'GAS preview function');
assert(gasCode.includes('applyMemberAnalysisResponseSchemaBootstrap'), 'GAS bootstrap function');
assert(gasCode.includes('legacy_schema_frozen'), 'GAS legacy skip reason');
assert(gasCode.includes('source_layout_changed'), 'GAS layout reject reason');
assert(gasCode.includes('member_analysis_response_schema'), 'GAS schema column');
assert(gasCode.includes('member_analysis_source_layout_hash'), 'GAS layout column');
assert(gasCode.includes('evaluateResponseSchemaSyncGate_'), 'GAS sync gate');
assert(
  gasCode.includes('function resyncMemberAnalysisSemanticResponseForPhase5E'),
  'GAS controlled resync function',
);
assert(
  gasCode.includes('PHASE5E_CONTROLLED_SEMANTIC_SYNC_ID'),
  'GAS controlled sync_id constant',
);
{
  const onOpenMatch = gasCode.match(/function onOpen\(\)[\s\S]*?\nfunction /);
  const onOpenBody = onOpenMatch ? onOpenMatch[0] : '';
  assert(!!onOpenBody, 'located onOpen body');
  assert(
    !onOpenBody.includes('resyncMemberAnalysisSemanticResponseForPhase5E'),
    'controlled resync not on menu',
  );
}
assert(
  gasCode.includes('phase5e_controlled_resync'),
  'controlled resync allows unchanged hash path',
);
assert(
  gasCode.includes('bootstrapSchema === RESPONSE_SCHEMA_SEMANTIC_ITEMID_V3'),
  'GAS bootstrap writes layout only for semantic',
);
{
  const syncCoreMatch = gasCode.match(
    /function syncMemberAnalysisResponsesCore_\([\s\S]*?\nfunction [a-zA-Z0-9_]+/,
  );
  const syncCoreBody = syncCoreMatch ? syncCoreMatch[0] : '';
  assert(!!syncCoreBody, 'located syncMemberAnalysisResponsesCore_ body');
  assert(
    !syncCoreBody.includes('applyMemberAnalysisResponseSchemaBootstrap'),
    'sync core does not call bootstrap',
  );
}

const readme = fs.readFileSync(readmePath, 'utf8');
assert(readme.includes('Phase 5E'), 'README Phase 5E section');
assert(readme.includes('source_layout_changed'), 'README layout change rule');
assert(readme.includes('質問追加・削除・並び替え・header 変更をしない'), 'README Form freeze ops');
assert(readme.includes('legacy-physical-v1'), 'README legacy freeze');
assert(readme.includes('layout hash は空'), 'README legacy layout stays empty');

// questionnaire sync headers include new columns
assert(
  MEMBER_ANALYSIS_QUESTIONNAIRE_V1.syncColumnHeaders.includes('member_analysis_response_schema'),
  'v1 syncColumnHeaders includes response_schema',
);
assert(
  MEMBER_ANALYSIS_QUESTIONNAIRE_V1.syncColumnHeaders.includes('member_analysis_source_layout_hash'),
  'v1 syncColumnHeaders includes layout_hash',
);

console.log('\n=== Phase 5E: upgrade ordering / old GAS fail-closed ===\n');

const oldGasPayload = {
  source_response_id: V3_ID,
  answered_at: '2026-01-15T10:00:00+09:00',
  respondent_name: 'SYNTHETIC',
  raw_answers: { 氏名: 'SYNTHETIC' },
  item_answers: Object.fromEntries(Array.from({ length: 118 }, (_, i) => [`ITEM-${i}`, 3])),
  academic_year: 2026,
  // no response_schema_version / source_layout_hash — pre-5E GAS
};
assert(
  !validateSyncResponseForTest(oldGasPayload, { questionnaireVersion: QUESTIONNAIRE_VERSION_V3 }).ok,
  'new API + old GAS payload → FAIL closed',
);
assert(
  String(validateSyncResponseForTest(oldGasPayload, { questionnaireVersion: QUESTIONNAIRE_VERSION_V3 }).error || '')
    .includes('response_schema_version'),
  'old GAS fail reason mentions schema',
);

const nullFill = assertSourceLayoutUpsertAllowed(null, hashA);
assert(nullFill.ok && nullFill.value === hashA, 'DB NULL layout → fill on semantic sync');

assert(
  gasCode.includes("SYNC_ENABLE_PROPERTY = 'MEMBER_ANALYSIS_SYNC_ENABLED'")
    || fs.readFileSync(path.join(root, 'gas/member-analysis-sync/QuestionMapping.gs'), 'utf8')
      .includes('MEMBER_ANALYSIS_SYNC_ENABLED'),
  'SYNC_ENABLED gate present',
);
{
  const qm = fs.readFileSync(path.join(root, 'gas/member-analysis-sync/QuestionMapping.gs'), 'utf8');
  assert(
    qm.includes('function getMemberAnalysisSyncBlockInfo_')
      && qm.includes("syncEnabled === 'false'")
      && qm.includes('blocked: true'),
    'SYNC_ENABLED=false blocks sync',
  );
}

console.log(`\nPhase 5E: ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
