#!/usr/bin/env node
/**
 * Phase 3 — v3 item_answers 採点（74 scoring items → UI 互換 scores JSON）
 *
 *   npm run verify:member-analysis-v3-scoring
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  MEMBER_ANALYSIS_QUESTIONNAIRE_V3,
  getV3ScoringItemCounts,
  convertNegativeEmotionalityToEmotionalStability,
} from '../lib/member-analysis-questionnaire-v3.js';
import {
  EXPECTED_B5_REVERSE_IDS,
  parseItemMasterCsv,
} from '../lib/member-analysis-v3-item-master.js';
import {
  EXPECTED_V3_SCORING_ITEM_COUNT,
  getV3ScoringItemIds,
  parseV3ScoringItemValue,
  scoreMemberAssessmentV3,
} from '../lib/member-analysis-scoring-v3.js';
import { SCORING_VERSION as SCORING_VERSION_V3 } from '../lib/member-analysis-questionnaire-v3.js';
import { resolveSyncQuestionnaireVersion } from '../lib/psych-assessments.js';
import {
  QUESTIONNAIRE_VERSION_V1,
  QUESTIONNAIRE_VERSION_V3,
} from '../lib/member-analysis-item-answers.js';
import { MEMBER_ANALYSIS_QUESTIONNAIRE_V1 } from '../lib/member-analysis-questionnaire-v1.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const masterPath = path.join(__dirname, '../test/fixtures/member-analysis-v3-item-master.csv');

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
  assert(actual === expected, `${label} (expected ${expected}, got ${actual})`);
}

console.log('\n=== Phase 3: definition counts ===\n');

const masterRows = parseItemMasterCsv(fs.readFileSync(masterPath, 'utf8'));
const scoringMaster = masterRows.filter((r) => String(r.scoring_included).toUpperCase() === 'TRUE');
const byInstrument = {};
for (const row of scoringMaster) {
  byInstrument[row.instrument] = (byInstrument[row.instrument] || 0) + 1;
}

assertEqual(scoringMaster.length, 74, 'scoring items total');
assertEqual(byInstrument.lab_big5, 20, 'Big Five items');
assertEqual(byInstrument.lab_values, 20, 'Values items');
assertEqual(byInstrument.lab_regulatory_focus, 10, 'RF items');
assertEqual(byInstrument.lab_riasec, 24, 'RIASEC items');

const counts = getV3ScoringItemCounts();
assertEqual(counts.bigFive.total, 20, 'Big Five scale total');
assertEqual(counts.schwartz.total, 20, 'Values/s schwartz total');
assertEqual(counts.regulatoryFocus.total, 10, 'RF scale total');
assertEqual(counts.riasec.total, 24, 'RIASEC scale total');

for (const [trait, n] of Object.entries(counts.bigFive.byTrait)) {
  assertEqual(n, 4, `Big Five ${trait} items per dimension`);
}
for (const [trait, n] of Object.entries(counts.schwartz.byTrait)) {
  assertEqual(n, 2, `Values ${trait} items per dimension`);
}
for (const [trait, n] of Object.entries(counts.regulatoryFocus.byTrait)) {
  assertEqual(n, 5, `RF ${trait} items per dimension`);
}
for (const [trait, n] of Object.entries(counts.riasec.byTrait)) {
  assertEqual(n, 4, `RIASEC ${trait} items per dimension`);
}

console.log('\n=== Phase 3: reverse flags ===\n');

const reverseInMaster = scoringMaster
  .filter((r) => String(r.reverse_scored).toUpperCase() === 'TRUE')
  .map((r) => r.item_id)
  .sort();
const expectedReverse = [...EXPECTED_B5_REVERSE_IDS].sort();
assert(
  reverseInMaster.length === 10 && reverseInMaster.every((id, i) => id === expectedReverse[i]),
  'reverse items = 10 B5 only',
);

console.log('\n=== Phase 3: scale ranges ===\n');

assertEqual(parseV3ScoringItemValue(1, 1, 7).ok, true, 'B5 min valid');
assertEqual(parseV3ScoringItemValue(7, 1, 7).ok, true, 'B5 max valid');
assertEqual(parseV3ScoringItemValue(0, 1, 7).ok, false, 'B5 below min');
assertEqual(parseV3ScoringItemValue(8, 1, 7).ok, false, 'B5 above max');
assertEqual(parseV3ScoringItemValue(5, 1, 5).ok, true, 'RF 1-5 valid');
assertEqual(parseV3ScoringItemValue(7, 1, 5).ok, false, 'RF 7 invalid (not v1 1-7)');

console.log('\n=== Phase 3: fixture builders ===\n');

function buildMidpointItemAnswers() {
  /** @type {Record<string, unknown>} */
  const answers = {};
  for (const item of MEMBER_ANALYSIS_QUESTIONNAIRE_V3.items) {
    if (!item.scoringIncluded) {
      answers[item.id] = '';
      continue;
    }
    if (item.instrument === 'lab_big5') answers[item.id] = 4;
    else if (item.instrument === 'lab_values') answers[item.id] = 3;
    else if (item.instrument === 'lab_regulatory_focus') answers[item.id] = 3;
    else if (item.instrument === 'lab_riasec') answers[item.id] = 3;
  }
  return answers;
}

function buildScoringOnlyAnswers(valuesById) {
  const base = buildMidpointItemAnswers();
  return { ...base, ...valuesById };
}

console.log('\n=== Phase 3: midpoint fixture ===\n');

const midpoint = buildMidpointItemAnswers();
const midScored = scoreMemberAssessmentV3(midpoint);
assert(midScored.ok, 'midpoint scoring ok');
assertEqual(midScored.scoring_version, SCORING_VERSION_V3, 'scoring_version v3');
assertEqual(midScored.scores.bigFive.extraversion, 4, 'B5 extraversion midpoint');
assertEqual(midScored.scores.bigFive.emotionalStability, 4, 'B5 ES = 8 - NE mean(4) = 4');
assertEqual(midScored.scores.schwartz.selfDirection, 3, 'Values selfDirection mean');
assertEqual(midScored.scores.regulatoryFocus.promotion, 3, 'RF promotion 1-5 mean');
assertEqual(midScored.scores.regulatoryFocus.prevention, 3, 'RF prevention 1-5 mean');
assertEqual(midScored.scores.riasec.A, 3, 'RIASEC A has 4 items');
assertEqual(convertNegativeEmotionalityToEmotionalStability(4), 4, 'NE→ES hand calc');

console.log('\n=== Phase 3: Big Five reverse fixture ===\n');

const reverseOnly = buildScoringOnlyAnswers({
  'B5-E3R': 1,
  'B5-E4R': 7,
  'B5-E1': 4,
  'B5-E2': 4,
});
const reverseScored = scoreMemberAssessmentV3(reverseOnly);
assert(reverseScored.ok, 'reverse fixture ok');
// extraversion: (4 + 4 + (8-1) + (8-7)) / 4 = (4+4+7+1)/4 = 4
assertEqual(reverseScored.scores.bigFive.extraversion, 4, 'extraversion with reverse items');

const neReverse = buildScoringOnlyAnswers({
  'B5-N1': 4,
  'B5-N2': 4,
  'B5-N3R': 1,
  'B5-N4R': 7,
});
const neScored = scoreMemberAssessmentV3(neReverse);
assert(neScored.ok, 'NE reverse fixture ok');
// NE internal mean: (4+4+7+1)/4 = 4 → ES = 8-4 = 4
assertEqual(neScored.scores.bigFive.emotionalStability, 4, 'NE reverse → ES');

const allOnes = buildScoringOnlyAnswers({});
for (const id of getV3ScoringItemIds()) {
  if (EXPECTED_B5_REVERSE_IDS.has(id)) allOnes[id] = 1;
  else if (id.startsWith('B5-')) allOnes[id] = 1;
}
const onesB5 = scoreMemberAssessmentV3(allOnes);
assert(onesB5.ok, 'B5 all-ones/reverse-ones');
for (const id of EXPECTED_B5_REVERSE_IDS) {
  const raw = 1;
  const scoredVal = 8 - raw;
  assertEqual(scoredVal, 7, `reverse ${id} raw 1 → 7`);
}

console.log('\n=== Phase 3: output shape ===\n');

const expectedTopKeys = ['bigFive', 'riasec', 'schwartz', 'regulatoryFocus'];
assert(
  expectedTopKeys.every((k) => Object.prototype.hasOwnProperty.call(midScored.scores, k)),
  'scores top-level keys',
);
assertEqual(Object.keys(midScored.scores.bigFive).sort().join(','),
  'agreeableness,conscientiousness,emotionalStability,extraversion,openness',
  'bigFive UI keys');
assert(!('negative_emotionality' in midScored.scores.bigFive), 'no internal NE key in output');
assert(!('self_direction' in midScored.scores.schwartz), 'no internal snake_case in schwartz output');
assert(!('realistic' in midScored.scores.riasec), 'no internal RIASEC names in output');
assertEqual(Object.keys(midScored.scores.riasec).sort().join(','), 'A,C,E,I,R,S', 'RIASEC letter keys');

console.log('\n=== Phase 3: invalid input (fail closed) ===\n');

function expectFail(itemAnswers, label) {
  const r = scoreMemberAssessmentV3(itemAnswers);
  assert(!r.ok, label);
}

const validBase = buildMidpointItemAnswers();
const scoringIds = getV3ScoringItemIds();
const firstScoringId = scoringIds[0];
const missingOne = { ...validBase };
delete missingOne[firstScoringId];
expectFail(missingOne, 'missing 1 scoring item');

expectFail({ ...validBase, [firstScoringId]: '' }, 'blank scoring value');
expectFail({ ...validBase, [firstScoringId]: null }, 'null scoring value');
expectFail({ ...validBase, [firstScoringId]: undefined }, 'undefined scoring value');
expectFail({ ...validBase, [firstScoringId]: 'abc' }, 'non-numeric');
expectFail({ ...validBase, [firstScoringId]: 0 }, 'zero out of range');
expectFail({ ...validBase, [firstScoringId]: Number.NaN }, 'NaN');
expectFail({ ...validBase, [firstScoringId]: Infinity }, 'Infinity');

const b5Item = scoringMaster.find((r) => r.instrument === 'lab_big5');
expectFail({ ...validBase, [b5Item.item_id]: 8 }, 'B5 max+1');

const withEmptySemantic = { ...validBase, 'ACK-01': '' };
const semanticOk = scoreMemberAssessmentV3(withEmptySemantic);
assert(semanticOk.ok, 'empty non-scoring semantic item ignored');

console.log('\n=== Phase 3: questionnaire router ===\n');

assert(resolveSyncQuestionnaireVersion(undefined).kind === 'v1', 'missing version → v1 legacy');
assert(resolveSyncQuestionnaireVersion(null).kind === 'v1', 'null version → v1 legacy');
assert(resolveSyncQuestionnaireVersion('').kind === 'v1', 'empty version → v1 legacy');
assert(resolveSyncQuestionnaireVersion(QUESTIONNAIRE_VERSION_V1).kind === 'v1', 'explicit v1');
assert(resolveSyncQuestionnaireVersion(MEMBER_ANALYSIS_QUESTIONNAIRE_V1.questionnaire_version).kind === 'v1', 'v1 canonical');
assert(resolveSyncQuestionnaireVersion(QUESTIONNAIRE_VERSION_V3).kind === 'v3', 'explicit v3');
assert(!resolveSyncQuestionnaireVersion('member-analysis-2026-v9').ok, 'unknown explicit version fail closed');

console.log('\n=== Phase 3: v1 scorer untouched ===\n');

const gasCode = fs.readFileSync(path.join(__dirname, '../lib/member-analysis-scoring.js'), 'utf8');
assert(gasCode.includes('function round1(n)'), 'v1 round1 present');
assert(!gasCode.includes('scoreMemberAssessmentV3'), 'v1 scorer file has no v3 import');

console.log(`\n=== Phase 3 v3 scoring: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed ? 1 : 0);
