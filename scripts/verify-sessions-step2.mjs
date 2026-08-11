#!/usr/bin/env node
/**
 * Phase 2a Step 2 検証スクリプト（純粋関数 + 任意で Neon 実DB）
 *
 * 使い方:
 *   node scripts/verify-sessions-step2.mjs
 *   DATABASE_URL='postgresql://...' node scripts/verify-sessions-step2.mjs
 */
import {
  mapScheduleItemToSession,
  validateScheduleItems,
  parseSessionDate,
  parseTimeHm,
  toTimestamptzJst,
  parseListSessionsParams,
  upsertSessionFromSchedule,
  syncSessionsFromSchedule,
  countSessions,
  getSessionById,
} from '../lib/sessions.js';

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

console.log('\n=== Phase 2a Step 2: 純粋関数 ===\n');

// parseSessionDate / parseTimeHm
assert(parseSessionDate('2026-08-21') === '2026-08-21', 'valid date');
assert(parseSessionDate('bad') === null, 'invalid date');
assert(parseTimeHm('9:30') === '09:30', 'time normalize');
assert(parseTimeHm('25:00') === null, 'invalid time');
assert(toTimestamptzJst('2026-08-21', '18:00') === '2026-08-21T18:00:00+09:00', 'JST timestamptz');
assert(toTimestamptzJst('2026-08-21', '') === null, 'no fake start time');

// mapping
const mapped = mapScheduleItemToSession({
  session_key: 'seminar_2026_007',
  date: '2026-08-21',
  type: 'presentation',
  content: '発表会',
  place: '301',
  preparations: 'prep',
  submissions: 'sub',
  note: 'memo',
  start: '18:00',
  end: '20:00',
  timeOverride: '18:30-20:30',
});

assert(mapped.source === 'sheets', 'source = sheets');
assert(mapped.source_key === 'seminar_2026_007', 'source_key');
assert(mapped.type === 'seminar', 'type = seminar');
assert(mapped.event_subtype === 'presentation', 'event_subtype from Sheets type');
assert(mapped.title === '発表会', 'title from content');
assert(mapped.session_date === '2026-08-21', 'session_date');
assert(mapped.starts_at === '2026-08-21T18:00:00+09:00', 'starts_at');
assert(mapped.ends_at === '2026-08-21T20:00:00+09:00', 'ends_at');
assert(mapped.status === 'scheduled', 'status scheduled');
assert(mapped.session_no === null, 'session_no null');
assert(mapped.metadata.timeOverride === '18:30-20:30', 'timeOverride in metadata');

const noTime = mapScheduleItemToSession({
  session_key: 'seminar_2026_008',
  date: '2026-09-01',
  type: 'lecture',
  content: '講義',
  start: '',
  end: '',
});
assert(noTime.starts_at === null && noTime.ends_at === null, 'nullable times when missing');

// validate: skip missing session_key
const v1 = validateScheduleItems([
  { date: '2026-09-01', session_key: null, content: 'x' },
  { date: '2026-09-02', session_key: 'seminar_2026_001', content: 'ok' },
]);
assert(v1.ok === true, 'validate ok with skip');
assert(v1.skipped.length === 1, 'one skipped');
assert(v1.skipped[0].reason === 'missing_session_key', 'skip reason');

// validate: duplicate keys → error
const v2 = validateScheduleItems([
  { date: '2026-08-21', session_key: 'seminar_2026_007', content: 'a' },
  { date: '2026-08-28', session_key: 'seminar_2026_007', content: 'b' },
]);
assert(v2.ok === false, 'duplicate → not ok');
assert(v2.error === 'duplicate_session_key', 'duplicate error code');
assert(v2.keys.includes('seminar_2026_007'), 'duplicate key listed');

// parseListSessionsParams
const lp = parseListSessionsParams({ date: '2026-08-21', type: 'seminar', limit: '10' });
assert(lp.date === '2026-08-21' && lp.type === 'seminar' && lp.limit === 10, 'list params');

try {
  parseListSessionsParams({ date: 'not-a-date' });
  assert(false, 'bad date should throw');
} catch (e) {
  assert(e.status === 400, 'bad date → 400');
}

console.log('\n=== Phase 2a Step 2: Neon 実DB（DATABASE_URL 設定時） ===\n');

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.log('  (skip) DATABASE_URL 未設定 — UPSERT / idempotency / date change はスキップ\n');
} else {
  const testKey = `seminar_test_${Date.now()}`;

  try {
    const item = {
      session_key: testKey,
      date: '2026-08-21',
      type: 'lecture',
      content: 'DB test',
      place: 'lab',
      start: '10:00',
      end: '11:00',
    };

    const first = await upsertSessionFromSchedule(mapScheduleItemToSession(item));
    assert(!!first.id, 'first upsert returns id');

    const second = await upsertSessionFromSchedule(mapScheduleItemToSession(item));
    assert(first.id === second.id, 'idempotent upsert keeps same id');

    const countAfterDup = await countSessions();
    const again = await syncSessionsFromSchedule([item]);
    assert(again.synced === 1, 'sync one item');
    const countAfterSync = await countSessions();
    assert(countAfterDup === countAfterSync, 're-sync does not duplicate rows');

    item.date = '2026-08-28';
    item.content = 'rescheduled';
    const third = await upsertSessionFromSchedule(mapScheduleItemToSession(item));
    assert(third.id === first.id, 'date change keeps UUID');
    assert(third.session_date === '2026-08-28', 'session_date updated');
    assert(third.title === 'rescheduled', 'title updated');

    const fetched = await getSessionById(first.id);
    assert(fetched?.source_key === testKey, 'getSessionById works');

    console.log(`  (cleanup) test row ${testKey} left in DB for inspection`);
  } catch (e) {
    failed += 1;
    console.error('  ✗ DB tests failed:', e.message);
    if (e.message?.includes('sessions')) {
      console.error('    → db/migrations/2026-08-sessions.sql を Neon に適用してください');
    }
  }
}

console.log(`\n=== 結果: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
