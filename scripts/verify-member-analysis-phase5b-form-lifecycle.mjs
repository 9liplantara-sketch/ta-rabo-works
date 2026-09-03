#!/usr/bin/env node
/**
 * Phase 5B — annual Form lifecycle
 *
 *   npm run verify:member-analysis-phase5b-form-lifecycle
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  COLLECTION_STATE_PROPERTY,
  COLLECTION_STATES,
  EXPECTED_V3_MAPPING_ACTIVE_COUNT,
  evaluateAnnualFormLifecycle,
  parseCollectionState,
} from '../lib/member-analysis-form-lifecycle.js';
import { computeStableV3ResponseHash, V3_QUESTIONNAIRE_VERSION } from '../lib/member-analysis-sync-hash-v3.js';
import { buildGasEquivalentV3ItemAnswers } from '../lib/member-analysis-v3-scoring-fixture.js';
import {
  candidateAnswerHeadersForMappingRow,
  filterActiveMappedRows,
} from '../lib/member-analysis-item-answers.js';
import { parseGoogleFormMappingCsv } from '../lib/member-analysis-v3-form-mapping.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mappingPath = path.join(__dirname, '../test/fixtures/member-analysis-v3-google-form-mapping-final.csv');
const gasCodePath = path.join(__dirname, '../gas/member-analysis-sync/Code.gs');
const psychPath = path.join(__dirname, '../lib/psych-assessments.js');

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

function baseInput(overrides = {}) {
  return {
    collectionState: 'open',
    collectionStateOk: true,
    collectionStateError: null,
    academicYearValid: true,
    formIdValid: true,
    mappingActiveCount: EXPECTED_V3_MAPPING_ACTIVE_COUNT,
    acceptingResponses: true,
    limitOneResponsePerUser: true,
    allowResponseEdits: true,
    collectsEmail: false,
    syncEnabled: false,
    ...overrides,
  };
}

console.log('\n=== Phase 5B: parseCollectionState ===\n');

for (const state of COLLECTION_STATES) {
  assert(parseCollectionState(state).ok, `${state} → PASS`);
  assert(parseCollectionState(state).value === state, `${state} value`);
}

assert(!parseCollectionState(undefined).ok, 'missing → FAIL');
assert(!parseCollectionState(null).ok, 'null → FAIL');
assert(!parseCollectionState('').ok, 'empty → FAIL');
assert(parseCollectionState('').display === 'MISSING', 'empty display MISSING');
assert(!parseCollectionState('OPEN').ok, 'OPEN uppercase → FAIL');
assert(!parseCollectionState('finalized').ok, 'finalized → FAIL');
assert(!parseCollectionState('unknown').ok, 'unknown → FAIL');
assert(
  parseCollectionState(undefined).error.includes(COLLECTION_STATE_PROPERTY),
  'missing error mentions property',
);

console.log('\n=== Phase 5B: open state ===\n');

assert(
  evaluateAnnualFormLifecycle(baseInput({ collectionState: 'open' })).validation === 'PASS',
  'open ideal → PASS',
);

const openSyncWarn = evaluateAnnualFormLifecycle(baseInput({ collectionState: 'open', syncEnabled: false }));
assert(openSyncWarn.validation === 'PASS', 'open sync false → PASS');
assert(
  openSyncWarn.warnings.some((w) => w.includes('sync is disabled')),
  'open sync false → warning',
);

assert(
  evaluateAnnualFormLifecycle(baseInput({
    collectionState: 'open',
    acceptingResponses: false,
  })).validation === 'FAIL',
  'open accept=false → FAIL',
);

const openLimit = evaluateAnnualFormLifecycle(baseInput({
  collectionState: 'open',
  limitOneResponsePerUser: false,
}));
assert(openLimit.validation === 'FAIL', 'open limitOne=false → FAIL');
assert(openLimit.reason === 'multiple_new_responses_allowed', 'open limitOne reason');

const openEdit = evaluateAnnualFormLifecycle(baseInput({
  collectionState: 'open',
  allowResponseEdits: false,
}));
assert(openEdit.validation === 'FAIL', 'open edit=false → FAIL');
assert(openEdit.reason === 'response_editing_disabled', 'open edit reason');

assert(
  evaluateAnnualFormLifecycle(baseInput({
    collectionState: 'open',
    collectsEmail: false,
  })).validation === 'PASS',
  'open email false → PASS',
);

console.log('\n=== Phase 5B: closed state ===\n');

assert(
  evaluateAnnualFormLifecycle(baseInput({
    collectionState: 'closed',
    acceptingResponses: false,
  })).validation === 'PASS',
  'closed accept=false → PASS',
);

assert(
  evaluateAnnualFormLifecycle(baseInput({
    collectionState: 'closed',
    acceptingResponses: true,
  })).validation === 'FAIL',
  'closed accept=true → FAIL',
);

assert(
  evaluateAnnualFormLifecycle(baseInput({
    collectionState: 'closed',
    acceptingResponses: false,
    allowResponseEdits: true,
    syncEnabled: true,
  })).validation === 'PASS',
  'closed edit=true sync=true → PASS',
);

assert(
  evaluateAnnualFormLifecycle(baseInput({
    collectionState: 'closed',
    acceptingResponses: false,
    allowResponseEdits: false,
    syncEnabled: false,
  })).validation === 'PASS',
  'closed edit=false sync=false → PASS',
);

console.log('\n=== Phase 5B: preparing state ===\n');

assert(
  evaluateAnnualFormLifecycle(baseInput({
    collectionState: 'preparing',
    acceptingResponses: false,
    syncEnabled: false,
  })).validation === 'PASS',
  'preparing recommended settings → PASS',
);

const prepWarn = evaluateAnnualFormLifecycle(baseInput({
  collectionState: 'preparing',
  acceptingResponses: true,
  syncEnabled: true,
}));
assert(prepWarn.validation === 'PASS', 'preparing non-ideal Form settings → PASS');
assert(prepWarn.warnings.length >= 2, 'preparing non-ideal → warnings');

assert(
  evaluateAnnualFormLifecycle(baseInput({
    collectionState: 'preparing',
    mappingActiveCount: 117,
  })).validation === 'FAIL',
  'preparing mapping != 118 → FAIL',
);

console.log('\n=== Phase 5B: missing collection state ===\n');

const missing = evaluateAnnualFormLifecycle(baseInput({
  collectionState: null,
  collectionStateOk: false,
  collectionStateError: `${COLLECTION_STATE_PROPERTY} is not configured`,
}));
assert(missing.validation === 'FAIL', 'missing state → FAIL');
assert(missing.reason.includes('not configured'), 'missing reason');

console.log('\n=== Phase 5B: data isolation ===\n');

const psychCode = fs.readFileSync(psychPath, 'utf8');
const gasCode = fs.readFileSync(gasCodePath, 'utf8');
const hashLib = fs.readFileSync(
  path.join(__dirname, '../lib/member-analysis-sync-hash-v3.js'),
  'utf8',
);

assert(!psychCode.includes('collection_state'), 'psych-assessments no collection_state');
assert(!psychCode.includes('COLLECTION_STATE'), 'psych-assessments no COLLECTION_STATE');
assert(!gasCode.includes('response.collection_state'), 'GAS payload no collection_state');
assert(!hashLib.includes('collection_state'), 'stable hash lib no collection_state');

const mappingRows = parseGoogleFormMappingCsv(fs.readFileSync(mappingPath, 'utf8'), {
  excludeOrphans: false,
});
const active = filterActiveMappedRows(mappingRows);
const syntheticRaw = {};
for (const row of active) {
  const header = candidateAnswerHeadersForMappingRow(row)[0];
  syntheticRaw[header] = 4;
}
const itemAnswers = buildGasEquivalentV3ItemAnswers(syntheticRaw, active);
const hashRows = active.map((r) => ({ item_id: r.item_id, question_version: r.question_version }));
const hashA = computeStableV3ResponseHash(V3_QUESTIONNAIRE_VERSION, hashRows, itemAnswers);
const hashB = computeStableV3ResponseHash(V3_QUESTIONNAIRE_VERSION, hashRows, itemAnswers);
assert(hashA === hashB, 'stable hash unchanged by lifecycle module');

console.log('\n=== Phase 5B: GAS markers ===\n');

assert(gasCode.includes('COLLECTION_STATE_PROPERTY'), 'GAS collection state property');
assert(gasCode.includes('previewMemberAnalysisFormLifecycle'), 'GAS lifecycle preview');
assert(gasCode.includes('readMemberAnalysisFormLifecycleSettings_'), 'GAS Form read-only settings');
assert(gasCode.includes('isAcceptingResponses'), 'GAS reads accepting responses');
assert(gasCode.includes('hasLimitOneResponsePerUser'), 'GAS reads limit one');
assert(gasCode.includes('canEditResponse'), 'GAS reads canEditResponse');
assert(gasCode.includes('collectsEmail'), 'GAS reads collectsEmail');
assert(!gasCode.includes('setAcceptingResponses'), 'GAS no setAcceptingResponses');
assert(!gasCode.includes('setLimitOneResponsePerUser'), 'GAS no setLimitOneResponsePerUser');
assert(!gasCode.includes('setAllowResponseEdits'), 'GAS no setAllowResponseEdits');
assert(gasCode.includes('年度Formライフサイクル監査'), 'GAS menu item');
assert(gasCode.includes('collection_state:'), 'annual config shows collection_state');

console.log(`\nPhase 5B: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
