#!/usr/bin/env node
/**
 * Phase K1 — 研究室の知見（RECORDS/SOURCES）検証
 */
import {
  isDailyReportEligibleForKnowledge,
  canViewKnowledgeRecord,
  canUseSourceForKnowledge,
  canWriteKnowledgeRecord,
  KNOWLEDGE_ELIGIBLE_DAILY_VISIBILITIES,
} from '../lib/knowledge-access.js';
import {
  buildDailyReportBodyText,
  buildDailyReportTitle,
  mapDailyReportToKnowledgeSource,
  mapKnowledgeRecordToSource,
  filterDailyReportsForKnowledgeFeed,
  filterSourcesVisibleToUser,
  excerptText,
  getSourceTypeLabel,
} from '../lib/knowledge-sources.js';
import {
  parseKnowledgeVisibility,
  parseRecordType,
  KNOWLEDGE_RECORD_TYPES,
} from '../lib/knowledge-records.js';

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

const admin = { role: 'admin', email: 'admin@example.com' };
const student = { role: 'student', email: 's@example.com', studentId: 's1' };

console.log('\n=== Phase K1: daily report privacy (knowledge feed) ===\n');

const reports = [
  { id: 'a', visibility: 'private', student_name: 'A', report_date: '2026-01-01', did_today: 'x' },
  { id: 'b', visibility: 'lab', student_name: 'B', report_date: '2026-01-02', did_today: 'y' },
  { id: 'c', visibility: 'public', student_name: 'C', report_date: '2026-01-03', did_today: 'z' },
];

assert(!isDailyReportEligibleForKnowledge(reports[0]), 'private not eligible');
assert(isDailyReportEligibleForKnowledge(reports[1]), 'lab eligible');
assert(isDailyReportEligibleForKnowledge(reports[2]), 'public eligible');

const feed = filterDailyReportsForKnowledgeFeed(reports);
assert(feed.length === 2, 'feed: B and C only');
assert(!feed.some((s) => s.sourceId === 'a'), 'private A excluded even for admin path');
assert(feed.every((s) => KNOWLEDGE_ELIGIBLE_DAILY_VISIBILITIES.includes(s.visibility)), 'feed visibilities');

const privateMapped = mapDailyReportToKnowledgeSource(reports[0]);
assert(privateMapped === null, 'map private → null');

const labMapped = mapDailyReportToKnowledgeSource(reports[1]);
assert(labMapped?.sourceKind === 'daily_report', 'lab → sourceKind');
assert(labMapped?.editable === false, 'daily_report editable=false');
assert(labMapped?.title === 'Bの日報', 'daily report title');

console.log('\n=== Phase K1: visibility change simulation (no copy) ===\n');

const mutable = { ...reports[1] };
let simFeed = filterDailyReportsForKnowledgeFeed([mutable]);
assert(simFeed.length === 1, 'lab report in feed');

mutable.visibility = 'private';
simFeed = filterDailyReportsForKnowledgeFeed([mutable]);
assert(simFeed.length === 0, 'lab→private: gone from feed');

mutable.visibility = 'lab';
simFeed = filterDailyReportsForKnowledgeFeed([mutable]);
assert(simFeed.length === 1, 'private→lab: back in feed');

console.log('\n=== Phase K1: knowledge record visibility ===\n');

const labRecord = { visibility: 'lab', record_type: 'transcript', id: 'r1', title: 'T', body_text: 'b', occurred_at: '2026-01-01' };
const adminRecord = { visibility: 'admin', record_type: 'admin_note', id: 'r2', title: 'A', body_text: 'b', occurred_at: '2026-01-01' };

assert(canViewKnowledgeRecord(student, labRecord), 'student sees lab record');
assert(!canViewKnowledgeRecord(student, adminRecord), 'student cannot see admin record');
assert(canViewKnowledgeRecord(admin, adminRecord), 'admin sees admin record');

assert(canWriteKnowledgeRecord(admin), 'admin can write');
assert(!canWriteKnowledgeRecord(student), 'student cannot write');

console.log('\n=== Phase K1: unified ViewModel ===\n');

const body = buildDailyReportBodyText({
  did_today: '作業',
  went_well: '良い',
  stuck_points: '',
  next_action: '次',
});
assert(body.includes('今日やったこと'), 'body sections');
assert(body.includes('うまくいったこと'), 'body went_well');

const krSource = mapKnowledgeRecordToSource({
  ...labRecord,
  participants: [{ studentId: 's1', name: '木下 涼' }],
});
assert(krSource.editable === true, 'knowledge_record editable');
assert(krSource.participants[0].name === '木下 涼', 'participant snapshot');

assert(getSourceTypeLabel('daily_report') === '日報', 'label daily_report');
assert(getSourceTypeLabel('transcript') === KNOWLEDGE_RECORD_TYPES.transcript, 'label transcript');

const longText = 'あ'.repeat(400);
assert(excerptText(longText).length <= 281, 'excerpt length');

console.log('\n=== Phase K1: filters / types ===\n');

assert(parseKnowledgeVisibility('lab').ok, 'visibility lab');
assert(parseKnowledgeVisibility('admin').ok, 'visibility admin');
assert(!parseKnowledgeVisibility('private').ok, 'visibility private rejected');

assert(parseRecordType('meeting_minutes').ok, 'record type valid');
assert(!parseRecordType('invalid').ok, 'record type invalid');

const mixedSources = [
  mapDailyReportToKnowledgeSource(reports[1]),
  mapKnowledgeRecordToSource(labRecord),
  mapDailyReportToKnowledgeSource(reports[0]),
];
const visibleToStudent = filterSourcesVisibleToUser(student, mixedSources);
assert(visibleToStudent.length === 2, 'student sees lab report + lab record only');
assert(canUseSourceForKnowledge(admin, { sourceKind: 'daily_report', visibility: 'private' }) === false, 'admin cannot use private in knowledge');

console.log('\n=== Phase K1: constants ===\n');
assert(Object.keys(KNOWLEDGE_RECORD_TYPES).length === 6, '6 record types');

console.log(`\n--- 結果: ${passed} passed, ${failed} failed ---\n`);
process.exit(failed > 0 ? 1 : 0);
