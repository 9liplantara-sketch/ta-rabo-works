#!/usr/bin/env node
/**
 * Phase 6C — member_profile_evidence.source_id TEXT widening
 */
import { readFileSync } from 'node:fs';
import {
  buildIntakeSourceId,
  parseIntakeSourceId,
  INTAKE_SOURCE_KIND,
} from '../lib/member-qualitative-intake-sources.js';
import {
  buildAllowedSourceIdSet,
  buildSourceMetaMap,
} from '../lib/member-qualitative-sources.js';
import { validateAiCandidate } from '../lib/member-qualitative-ai.js';
import {
  partitionEvidenceByAccessibility,
  isDailyReportRowAccessible,
} from '../lib/member-qualitative-evidence.js';

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

console.log('\n=== Phase 6C: schema / migration ===\n');

const schema = readFileSync('db/schema.sql', 'utf8');
const mig = readFileSync('db/migrations/2026-09-member-profile-evidence-source-id-text.sql', 'utf8');
const evidenceBlock = schema.slice(schema.indexOf('CREATE TABLE IF NOT EXISTS member_profile_evidence'));

assert(/source_id TEXT NOT NULL/.test(evidenceBlock), 'schema source_id = TEXT');
assert(!/source_id UUID NOT NULL/.test(evidenceBlock.split('CREATE TABLE')[0] + evidenceBlock.split(');')[0]), 'schema evidence block not UUID');
assert(evidenceBlock.includes('source_id TEXT NOT NULL'), 'evidence table declares TEXT');
assert(mig.includes('ALTER COLUMN source_id TYPE TEXT'), 'migration widens to TEXT');
assert(mig.includes('USING source_id::text'), 'migration preserves values via ::text');
assert(mig.includes('non-destructive type widening'), 'migration classified non-destructive');
assert(mig.includes('Phase 6C'), 'migration labeled Phase 6C');
assert(
  schema.includes('idx_member_profile_evidence_unique')
    && schema.includes('profile_item_id, source_kind, source_id, evidence_role'),
  'unique index columns preserved',
);

console.log('\n=== Phase 6C: intake composite representation ===\n');

const assessmentId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const itemId = 'SEED-01';
const composite = buildIntakeSourceId(assessmentId, itemId);
assert(composite === `${assessmentId}:${itemId}`, 'composite source_id format');
assert(!/^[0-9a-f-]{36}$/i.test(composite), 'composite is not a bare UUID');

const parsed = parseIntakeSourceId(composite);
assert(parsed?.assessmentId === assessmentId && parsed?.itemId === itemId, 'build→parse roundtrip');

const asTextRow = { source_kind: INTAKE_SOURCE_KIND, source_id: composite, evidence_role: 'supports' };
assert(typeof asTextRow.source_id === 'string', 'TEXT schema compatible string representation');

console.log('\n=== Phase 6C: daily_report / knowledge_record UUID-as-text ===\n');

const drUuid = '11111111-2222-3333-4444-555555555555';
const krUuid = '66666666-7777-8888-9999-aaaaaaaaaaaa';
assert(isDailyReportRowAccessible({ id: drUuid, visibility: 'lab' }), 'daily_report UUID text → accessibility path OK');

const { accessible, inaccessible } = partitionEvidenceByAccessibility(
  [
    { source_kind: 'daily_report', source_id: drUuid },
    { source_kind: 'daily_report', source_id: 'private-dr' },
    { source_kind: 'knowledge_record', source_id: krUuid },
    { source_kind: INTAKE_SOURCE_KIND, source_id: composite },
    { source_kind: INTAKE_SOURCE_KIND, source_id: 'not-a-valid-composite' },
  ],
  new Map([
    [drUuid, { id: drUuid, visibility: 'lab' }],
    ['private-dr', { id: 'private-dr', visibility: 'private' }],
  ]),
  new Map([
    [krUuid, { id: krUuid, visibility: 'lab', participants: [] }],
  ]),
  { role: 'admin' },
  new Set([composite]),
);

assert(accessible.some((e) => e.source_id === drUuid), 'daily_report UUID-as-text accessible');
assert(accessible.some((e) => e.source_id === composite), 'intake composite accessible when allowed');
assert(inaccessible.some((e) => e.source_id === 'not-a-valid-composite'), 'invalid composite inaccessible');
assert(inaccessible.some((e) => e.source_id === 'private-dr'), 'private daily still inaccessible');

console.log('\n=== Phase 6C: provenance validation ===\n');

const sources = [
  { sourceKind: 'daily_report', sourceId: drUuid, sourceType: 'daily_report' },
  { sourceKind: 'knowledge_record', sourceId: krUuid, sourceType: 'admin_note' },
  {
    sourceKind: INTAKE_SOURCE_KIND,
    sourceId: composite,
    sourceType: INTAKE_SOURCE_KIND,
    epistemicType: 'self_report',
  },
];
const allowed = buildAllowedSourceIdSet(sources);
const meta = buildSourceMetaMap(sources);

const good = {
  category: 'interest',
  statement: '自己申告の関心',
  epistemic_type: 'self_report',
  confidence: 'medium',
  relation_type: 'new',
  evidence: [{ source_kind: INTAKE_SOURCE_KIND, source_id: composite, evidence_role: 'supports' }],
};
assert(validateAiCandidate(good, allowed, meta).ok, 'intake composite allowed → candidate OK');

const fabricated = {
  ...good,
  evidence: [{ source_kind: INTAKE_SOURCE_KIND, source_id: 'ffffffff-ffff-ffff-ffff-ffffffffffff:FAKE', evidence_role: 'supports' }],
};
assert(!validateAiCandidate(fabricated, allowed, meta).ok, 'fabricated intake ID rejected');

const dailyOk = {
  category: 'interest',
  statement: '日報からの観察候補',
  epistemic_type: 'observed_pattern',
  confidence: 'low',
  relation_type: 'new',
  evidence: [{ source_kind: 'daily_report', source_id: drUuid, evidence_role: 'supports' }],
};
assert(validateAiCandidate(dailyOk, allowed, meta).ok, 'daily_report UUID-as-text candidate OK');

console.log(`\n--- 結果: ${passed} passed, ${failed} failed ---\n`);
if (failed) process.exit(1);
