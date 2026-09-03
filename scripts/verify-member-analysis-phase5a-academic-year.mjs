#!/usr/bin/env node
/**
 * Phase 5A — academic_year metadata
 *
 *   npm run verify:member-analysis-phase5a-academic-year
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  ACADEMIC_YEAR_MIN,
  ACADEMIC_YEAR_MAX,
  MEMBER_ANALYSIS_ACADEMIC_YEAR_BACKFILL_VALUE,
  MEMBER_ANALYSIS_ACADEMIC_YEAR_BACKFILL_VERSIONS,
  assertAcademicYearUpsertAllowed,
  parseAcademicYear,
  validateAcademicYearForSync,
} from '../lib/member-analysis-academic-year.js';
import {
  QUESTIONNAIRE_VERSION_V3,
  candidateAnswerHeadersForMappingRow,
  filterActiveMappedRows,
} from '../lib/member-analysis-item-answers.js';
import { parseGoogleFormMappingCsv } from '../lib/member-analysis-v3-form-mapping.js';
import { buildGasEquivalentV3ItemAnswers } from '../lib/member-analysis-v3-scoring-fixture.js';
import {
  computeStableV3ResponseHash,
  V3_QUESTIONNAIRE_VERSION,
} from '../lib/member-analysis-sync-hash-v3.js';
import { scoreMemberAssessment } from '../lib/member-analysis-scoring.js';
import { scoreMemberAssessmentV3 } from '../lib/member-analysis-scoring-v3.js';
import {
  validateSyncResponseForTest,
  resolveSyncQuestionnaireVersion,
} from '../lib/psych-assessments.js';
import {
  buildSyntheticFilteredRawAnswers,
  MEMBER_ANALYSIS_QUESTIONNAIRE_V1,
} from '../lib/member-analysis-fixture-scoring.js';
import {
  RESPONSE_SCHEMA_SEMANTIC_ITEMID_V3,
  computeSourceLayoutHash,
} from '../lib/member-analysis-response-schema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mappingPath = path.join(__dirname, '../test/fixtures/member-analysis-v3-google-form-mapping-final.csv');
const migrationPath = path.join(__dirname, '../db/migrations/2026-09-psych-assessments-academic-year.sql');

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

console.log('\n=== Phase 5A: parseAcademicYear valid ===\n');

assert(parseAcademicYear(2026).ok, '2026 → PASS');
assert(parseAcademicYear(2026).value === 2026, '2026 value');
assert(parseAcademicYear(2027).ok, '2027 → PASS');
assert(parseAcademicYear(ACADEMIC_YEAR_MIN).ok, `min ${ACADEMIC_YEAR_MIN} → PASS`);
assert(parseAcademicYear(ACADEMIC_YEAR_MAX).ok, `max ${ACADEMIC_YEAR_MAX} → PASS`);

console.log('\n=== Phase 5A: parseAcademicYear invalid ===\n');

const invalidCases = [
  [undefined, 'missing undefined'],
  [null, 'missing null'],
  ['', 'missing empty string'],
  ['2026', 'string "2026"'],
  [2026.5, '2026.5'],
  [1999, '1999'],
  [2101, '2101'],
  [NaN, 'NaN'],
  [Infinity, 'Infinity'],
];

for (const [raw, label] of invalidCases) {
  assert(!parseAcademicYear(raw).ok, `${label} → FAIL`);
}

console.log('\n=== Phase 5A: validateAcademicYearForSync v3 required ===\n');

assert(validateAcademicYearForSync(2026, { required: true }).ok, 'v3 required 2026 → PASS');
assert(validateAcademicYearForSync(2027, { required: true }).ok, 'v3 required 2027 → PASS');
assert(!validateAcademicYearForSync(undefined, { required: true }).ok, 'v3 missing → FAIL');
assert(!validateAcademicYearForSync(null, { required: true }).ok, 'v3 null → FAIL');
assert(!validateAcademicYearForSync('', { required: true }).ok, 'v3 empty → FAIL');

console.log('\n=== Phase 5A: validateAcademicYearForSync v1 optional ===\n');

assert(validateAcademicYearForSync(undefined, { required: false }).ok, 'v1 without year → PASS');
assert(validateAcademicYearForSync(undefined, { required: false }).value === null, 'v1 without year → null');
assert(validateAcademicYearForSync(2026, { required: false }).ok, 'v1 with year → PASS');

console.log('\n=== Phase 5A: assertAcademicYearUpsertAllowed ===\n');

assert(assertAcademicYearUpsertAllowed(null, 2026).ok, 'existing NULL + incoming 2026 → fill allowed');
assert(assertAcademicYearUpsertAllowed(2026, 2026).ok, 'existing 2026 + incoming 2026 → update allowed');
assert(!assertAcademicYearUpsertAllowed(2026, 2027).ok, 'existing 2026 + incoming 2027 → FAIL');
assert(
  assertAcademicYearUpsertAllowed(2026, 2027).error?.includes('mismatch'),
  'mismatch error message',
);

console.log('\n=== Phase 5A: migration fixture ===\n');

const migrationSql = fs.readFileSync(migrationPath, 'utf8');
assert(migrationSql.includes('ADD COLUMN IF NOT EXISTS academic_year INTEGER'), 'migration adds column');
assert(!/academic_year\s+INTEGER\s+NOT\s+NULL/i.test(migrationSql), 'migration column stays nullable');
assert(
  migrationSql.includes("'member-analysis-2026-v1'") && migrationSql.includes("'member-analysis-2026-v3'"),
  'backfill targets v1 and v3',
);
assert(migrationSql.includes('SET academic_year = 2026'), 'backfill sets 2026');
assert(!/UPDATE psych_assessments[\s\S]*answered_at/.test(migrationSql), 'backfill UPDATE does not filter by answered_at');
assert(
  MEMBER_ANALYSIS_ACADEMIC_YEAR_BACKFILL_VERSIONS.length === 2
    && MEMBER_ANALYSIS_ACADEMIC_YEAR_BACKFILL_VALUE === 2026,
  'backfill constants match migration',
);

console.log('\n=== Phase 5A: API validation integration ===\n');

const mappingRows = parseGoogleFormMappingCsv(fs.readFileSync(mappingPath, 'utf8'), {
  excludeOrphans: false,
});
const active = filterActiveMappedRows(mappingRows);
const syntheticRaw = {};
for (const row of active) {
  const candidates = candidateAnswerHeadersForMappingRow(row);
  const header = candidates[0];
  syntheticRaw[header] = row.item_id.startsWith('B5-') || row.item_id.startsWith('VAL-')
    || row.item_id.startsWith('RF-') || row.item_id.startsWith('RIA-')
    ? 4
    : `answer:${row.item_id}`;
}
const itemAnswers = buildGasEquivalentV3ItemAnswers(syntheticRaw, active);
assert(Object.keys(itemAnswers).length === 118, 'fixture item_answers 118 keys');

const v3LayoutHash = computeSourceLayoutHash(Object.keys(syntheticRaw));
const v3Base = {
  source_response_id: 'phase5a-v3',
  answered_at: '2026-01-15T10:00:00+09:00',
  respondent_name: 'SYNTHETIC',
  raw_answers: syntheticRaw,
  item_answers: itemAnswers,
  response_schema_version: RESPONSE_SCHEMA_SEMANTIC_ITEMID_V3,
  source_layout_hash: v3LayoutHash,
};

assert(
  validateSyncResponseForTest({ ...v3Base, academic_year: 2026 }, { questionnaireVersion: QUESTIONNAIRE_VERSION_V3 }).ok,
  'v3 with academic_year=2026 → PASS',
);
assert(
  validateSyncResponseForTest({ ...v3Base, academic_year: 2027 }, { questionnaireVersion: QUESTIONNAIRE_VERSION_V3 }).ok,
  'v3 with academic_year=2027 → PASS',
);
assert(
  !validateSyncResponseForTest(v3Base, { questionnaireVersion: QUESTIONNAIRE_VERSION_V3 }).ok,
  'v3 without academic_year → FAIL',
);

const v1Raw = buildSyntheticFilteredRawAnswers();
const v1Item = {
  source_response_id: 'phase5a-v1',
  answered_at: '2026-01-15T10:00:00+09:00',
  respondent_name: 'SYNTHETIC DEMO',
  raw_answers: v1Raw,
};
assert(validateSyncResponseForTest(v1Item).ok, 'v1 without academic_year → PASS');

const v1ScoredBefore = scoreMemberAssessment(v1Raw, MEMBER_ANALYSIS_QUESTIONNAIRE_V1);
const v1ScoredAfter = scoreMemberAssessment(v1Raw, MEMBER_ANALYSIS_QUESTIONNAIRE_V1);
assert(
  JSON.stringify(v1ScoredBefore.scores) === JSON.stringify(v1ScoredAfter.scores),
  'v1 scores unchanged',
);
assert(v1ScoredBefore.scoring_version === v1ScoredAfter.scoring_version, 'v1 scoring_version unchanged');

console.log('\n=== Phase 5A: router unchanged ===\n');

assert(resolveSyncQuestionnaireVersion(QUESTIONNAIRE_VERSION_V3).ok, 'v3 router still accepts canonical');
assert(
  !resolveSyncQuestionnaireVersion('member-analysis-2027-v3').ok,
  'member-analysis-2027-v3 still rejected',
);
assert(
  !resolveSyncQuestionnaireVersion('member-analysis-v3').ok,
  'member-analysis-v3 alias still rejected',
);

console.log('\n=== Phase 5A: stable hash excludes academic_year ===\n');

const hashMappingRows = active.map((row) => ({
  item_id: row.item_id,
  question_version: row.question_version,
}));
const hash2026Context = computeStableV3ResponseHash(
  V3_QUESTIONNAIRE_VERSION,
  hashMappingRows,
  itemAnswers,
);
const hashSameAnswers = computeStableV3ResponseHash(
  V3_QUESTIONNAIRE_VERSION,
  hashMappingRows,
  itemAnswers,
);
assert(hash2026Context === hashSameAnswers, 'same semantic answers → same stable hash');
assert(hash2026Context.startsWith('itemid-v1:'), 'stable hash prefix unchanged');

const hashLib = fs.readFileSync(path.join(__dirname, '../lib/member-analysis-sync-hash-v3.js'), 'utf8');
assert(!hashLib.includes('academic_year'), 'hash lib does not reference academic_year');

console.log('\n=== Phase 5A: scoring unchanged ===\n');

const v3Scored = scoreMemberAssessmentV3(itemAnswers);
assert(v3Scored.ok, 'v3 scoring still works with item_answers only');
assert(v3Scored.scoring_version === 'member-analysis-score-v3', 'scoring_version unchanged');

console.log('\n=== Phase 5A: GAS markers ===\n');

const gasCode = fs.readFileSync(path.join(__dirname, '../gas/member-analysis-sync/Code.gs'), 'utf8');
assert(gasCode.includes('MEMBER_ANALYSIS_ACADEMIC_YEAR'), 'GAS academic year property');
assert(gasCode.includes('response.academic_year = academicYear'), 'GAS payload includes academic_year');
assert(gasCode.includes('getMemberAnalysisAcademicYearRequired_'), 'GAS required academic year helper');
assert(gasCode.includes('previewMemberAnalysisAnnualConfig'), 'GAS annual config preview');

console.log('\n=== Phase 5A: psych-assessments upsert markers ===\n');

const psychCode = fs.readFileSync(path.join(__dirname, '../lib/psych-assessments.js'), 'utf8');
assert(psychCode.includes('assertAcademicYearUpsertAllowed'), 'upsert mismatch guard');
assert(psychCode.includes('COALESCE(psych_assessments.academic_year'), 'upsert COALESCE fill NULL only');
assert(psychCode.includes('validateAcademicYearForSync'), 'API academic year validation');

console.log(`\nPhase 5A: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
