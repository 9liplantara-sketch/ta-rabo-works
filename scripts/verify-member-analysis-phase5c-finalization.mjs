#!/usr/bin/env node
/**
 * Phase 5C — annual finalization audit
 *
 *   npm run verify:member-analysis-phase5c-finalization
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  EXPECTED_V3_ITEM_ANSWERS_KEY_COUNT,
  FINALIZATION_VALIDATION,
  V3_SCORE_BLOCKS,
  evaluateAnnualFinalization,
  evaluateNeonFinalizationSnapshot,
  evaluateV3ScoresCompleteness,
} from '../lib/member-analysis-annual-finalization.js';
import { EXPECTED_V3_MAPPING_ACTIVE_COUNT } from '../lib/member-analysis-form-lifecycle.js';
import { computeStableV3ResponseHash, V3_QUESTIONNAIRE_VERSION } from '../lib/member-analysis-sync-hash-v3.js';
import { buildGasEquivalentV3ItemAnswers } from '../lib/member-analysis-v3-scoring-fixture.js';
import {
  candidateAnswerHeadersForMappingRow,
  filterActiveMappedRows,
} from '../lib/member-analysis-item-answers.js';
import { parseGoogleFormMappingCsv } from '../lib/member-analysis-v3-form-mapping.js';
import { scoreMemberAssessmentV3 } from '../lib/member-analysis-scoring-v3.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mappingPath = path.join(__dirname, '../test/fixtures/member-analysis-v3-google-form-mapping-final.csv');
const gasCodePath = path.join(__dirname, '../gas/member-analysis-sync/Code.gs');

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

function readyInput(overrides = {}) {
  const form = { acceptingResponses: false, limitOneResponsePerUser: true, allowResponseEdits: false, collectsEmail: true, ...(overrides.form || {}) };
  const mapping = {
    activeCount: EXPECTED_V3_MAPPING_ACTIVE_COUNT,
    itemIdCount: EXPECTED_V3_MAPPING_ACTIVE_COUNT,
    unresolvedCount: 0,
    duplicateCount: 0,
    ...(overrides.mapping || {}),
  };
  const sheet = { responseRows: 4, synced: 4, error: 0, pending: 0, ...(overrides.sheet || {}) };
  const hash = {
    stable: 1,
    legacyCompatible: 3,
    legacyMismatch: 0,
    missing: 0,
    wouldSync: 0,
    ...(overrides.hash || {}),
  };
  const rest = { ...overrides };
  delete rest.form;
  delete rest.mapping;
  delete rest.sheet;
  delete rest.hash;
  return {
    collectionState: 'closed',
    collectionStateOk: true,
    academicYearValid: true,
    formIdValid: true,
    form,
    mapping,
    sheet,
    hash,
    syncEnabled: false,
    ...rest,
  };
}

console.log('\n=== Phase 5C: READY ===\n');

const ready = evaluateAnnualFinalization(readyInput());
assert(ready.ready === true, 'closed + clean sheet/hash/mapping → ready');
assert(ready.validation === FINALIZATION_VALIDATION.READY, 'validation READY');

const readySyncOn = evaluateAnnualFinalization(readyInput({ syncEnabled: true }));
assert(readySyncOn.validation === FINALIZATION_VALIDATION.READY, 'syncEnabled true is not a hard fail');

const mixedHash = evaluateAnnualFinalization(readyInput({
  hash: { stable: 2, legacyCompatible: 2, legacyMismatch: 0, missing: 0, wouldSync: 0 },
}));
assert(mixedHash.validation === FINALIZATION_VALIDATION.READY, 'legacy/stable mix → READY');

console.log('\n=== Phase 5C: NOT_READY ===\n');

const open = evaluateAnnualFinalization(readyInput({ collectionState: 'open' }));
assert(open.validation === FINALIZATION_VALIDATION.NOT_READY, 'open → NOT_READY');
assert(open.reason === 'collection_still_open', 'open reason');

const preparing = evaluateAnnualFinalization(readyInput({ collectionState: 'preparing' }));
assert(preparing.validation === FINALIZATION_VALIDATION.NOT_READY, 'preparing → NOT_READY');
assert(preparing.reason === 'collection_not_opened_or_closed', 'preparing reason');

const stillAccepting = evaluateAnnualFinalization(readyInput({
  form: { acceptingResponses: true, allowResponseEdits: false },
}));
assert(stillAccepting.validation === FINALIZATION_VALIDATION.NOT_READY, 'closed + accept=true → NOT_READY');
assert(stillAccepting.reason === 'accepting_responses_still_true', 'accepting reason');

assert(
  evaluateAnnualFinalization(readyInput({ sheet: { error: 1 } })).reason === 'sheet_sync_incomplete',
  'error>0 → sheet_sync_incomplete',
);
assert(
  evaluateAnnualFinalization(readyInput({ sheet: { pending: 1, synced: 3 } })).reason === 'sheet_sync_incomplete',
  'pending>0 → sheet_sync_incomplete',
);
assert(
  evaluateAnnualFinalization(readyInput({ sheet: { synced: 3 } })).reason === 'sheet_sync_incomplete',
  'synced != responses → sheet_sync_incomplete',
);
assert(
  evaluateAnnualFinalization(readyInput({ mapping: { activeCount: 117, itemIdCount: 117 } })).reason === 'mapping_invalid',
  'mapping != 118 → mapping_invalid',
);
assert(
  evaluateAnnualFinalization(readyInput({ hash: { legacyMismatch: 1 } })).reason === 'hash_not_clean',
  'hash mismatch>0 → hash_not_clean',
);
assert(
  evaluateAnnualFinalization(readyInput({ hash: { missing: 1 } })).reason === 'hash_not_clean',
  'hash missing>0 → hash_not_clean',
);
assert(
  evaluateAnnualFinalization(readyInput({ hash: { wouldSync: 1 } })).reason === 'hash_not_clean',
  'wouldSync>0 → hash_not_clean',
);

const missingState = evaluateAnnualFinalization(readyInput({
  collectionState: null,
  collectionStateOk: false,
  collectionStateError: 'MEMBER_ANALYSIS_COLLECTION_STATE is not configured',
}));
assert(missingState.validation === FINALIZATION_VALIDATION.FAIL, 'missing collection_state → FAIL');

const editWarn = evaluateAnnualFinalization(readyInput({
  form: { acceptingResponses: false, allowResponseEdits: true },
}));
assert(editWarn.validation === FINALIZATION_VALIDATION.READY, 'allow edits true still READY');
assert(
  editWarn.warnings.some((w) => w.includes('response editing setting remains enabled')),
  'allow edits true → WARN',
);

console.log('\n=== Phase 5C: Neon snapshot ===\n');

const neonOk = evaluateNeonFinalizationSnapshot({
  total: 4, scored: 4, itemAnswers118: 4, unmatched: 1, duplicateStudentRows: 0,
});
assert(neonOk.ready === true, 'unmatched WARN still READY');
assert(neonOk.warnings.some((w) => w.includes('unmatched_student')), 'unmatched warning');

const neonDup = evaluateNeonFinalizationSnapshot({
  total: 4, scored: 4, itemAnswers118: 4, unmatched: 0, duplicateStudentRows: 1,
});
assert(neonDup.ready === false, 'duplicate student_id → not ready');
assert(neonDup.reason === 'duplicate_student_year', 'duplicate reason');

assert(EXPECTED_V3_ITEM_ANSWERS_KEY_COUNT === 118, 'item_answers expected 118');
assert(V3_SCORE_BLOCKS.join(',') === 'bigFive,schwartz,riasec,regulatoryFocus', '4 score blocks');

const mappingRows = parseGoogleFormMappingCsv(fs.readFileSync(mappingPath, 'utf8'), { excludeOrphans: false });
const active = filterActiveMappedRows(mappingRows);
const syntheticRaw = {};
for (const row of active) {
  syntheticRaw[candidateAnswerHeadersForMappingRow(row)[0]] = 4;
}
const itemAnswers = buildGasEquivalentV3ItemAnswers(syntheticRaw, active);
const scored = scoreMemberAssessmentV3(itemAnswers);
assert(scored.ok, 'v3 scoring fixture ok');
const scoreCheck = evaluateV3ScoresCompleteness(scored.scores);
assert(scoreCheck.ok, 'v3 scores have 4 blocks');
assert(!evaluateV3ScoresCompleteness({}).ok, 'empty scores fail completeness');

console.log('\n=== Phase 5C: isolation ===\n');

const psychCode = fs.readFileSync(path.join(__dirname, '../lib/psych-assessments.js'), 'utf8');
const hashLib = fs.readFileSync(path.join(__dirname, '../lib/member-analysis-sync-hash-v3.js'), 'utf8');
const schema = fs.readFileSync(path.join(__dirname, '../db/schema.sql'), 'utf8');
assert(!psychCode.includes('evaluateAnnualFinalization'), 'psych-assessments unchanged by 5C');
assert(!hashLib.includes('finalization'), 'hash lib has no finalization');
assert(!schema.includes('finalized_at'), 'no finalized_at column');
assert(!schema.includes('annual_cycles'), 'no annual_cycles table');

const hashRows = active.map((r) => ({ item_id: r.item_id, question_version: r.question_version }));
const hashA = computeStableV3ResponseHash(V3_QUESTIONNAIRE_VERSION, hashRows, itemAnswers);
const hashB = computeStableV3ResponseHash(V3_QUESTIONNAIRE_VERSION, hashRows, itemAnswers);
assert(hashA === hashB, 'stable hash unchanged by finalization module');

console.log('\n=== Phase 5C: GAS markers ===\n');

const gasCode = fs.readFileSync(gasCodePath, 'utf8');
assert(gasCode.includes('previewMemberAnalysisAnnualFinalization'), 'GAS preview function');
assert(gasCode.includes('年度確定監査'), 'GAS menu item');
assert(gasCode.includes('evaluateMemberAnalysisAnnualFinalization_'), 'GAS evaluator');
assert(gasCode.includes('collection_still_open'), 'GAS open reason');
assert(!gasCode.includes('setAcceptingResponses'), 'GAS still has no Form mutation');
{
  const finStart = gasCode.indexOf('function previewMemberAnalysisAnnualFinalization');
  const finEnd = gasCode.indexOf('function previewMemberAnalysisResponseSchemas');
  const finBlock = gasCode.slice(finStart, finEnd > finStart ? finEnd : finStart + 12000);
  assert(!/UrlFetchApp\.fetch/.test(finBlock), 'finalization preview does not POST');
}

console.log(`\nPhase 5C: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
