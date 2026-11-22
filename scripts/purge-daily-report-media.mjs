#!/usr/bin/env node
/**
 * 期限切れの未使用日報画像を掃除（API と同一の claim → Blob 削除経路）。
 * 使用中（attached / report_id あり）は原子的 claim に失敗し Blob を触らない。
 *
 * 必要環境変数: DATABASE_URL, BLOB_READ_WRITE_TOKEN
 * オプション: PURGE_OLDER_THAN_HOURS (default 24), PURGE_LIMIT (default 50)
 * ドライラン: --dry-run（候補一覧のみ。claim しない）
 */
import {
  isMediaEligibleForPurge,
  purgeExpiredUnusedMedia,
  resetDailyReportMediaTableReadyCache,
  MEDIA_DELETE_RECLAIM_MINUTES,
} from '../lib/daily-report-media.js';
import { getDb } from '../lib/db.js';

const dryRun = process.argv.includes('--dry-run');
const olderThanHours = Math.min(
  168,
  Math.max(1, Number(process.env.PURGE_OLDER_THAN_HOURS || 24) || 24),
);
const limit = Math.min(200, Math.max(1, Number(process.env.PURGE_LIMIT || 50) || 50));

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}
if (!dryRun && !process.env.BLOB_READ_WRITE_TOKEN) {
  console.error('BLOB_READ_WRITE_TOKEN is required (or pass --dry-run)');
  process.exit(1);
}

resetDailyReportMediaTableReadyCache();

const adminUser = { role: 'admin', email: 'cli-purge@local', studentId: null };

if (dryRun) {
  const sql = getDb();
  const reclaim = MEDIA_DELETE_RECLAIM_MINUTES;
  const rows = await sql`
    SELECT id, report_id, status, updated_at, created_at, original_filename
    FROM daily_report_media
    WHERE report_id IS NULL
      AND (
        (
          status IN ('pending', 'orphaned', 'delete_failed')
          AND updated_at < NOW() - (${olderThanHours}::text || ' hours')::interval
        )
        OR (
          status = 'deleting'
          AND updated_at < NOW() - (${String(reclaim)}::text || ' minutes')::interval
        )
      )
    ORDER BY updated_at ASC
    LIMIT ${limit}
  `;
  console.log(`Dry-run candidates: ${rows.length} (olderThanHours=${olderThanHours})`);
  for (const row of rows) {
    const ok = isMediaEligibleForPurge(row, { olderThanHours });
    console.log(`  ${ok ? 'would-claim' : 'skip'} ${row.id} status=${row.status}`);
  }
  process.exit(0);
}

const { purged, results } = await purgeExpiredUnusedMedia(adminUser, {
  olderThanHours,
  limit,
});

let skipped = 0;
let failed = 0;
for (const r of results) {
  if (r.ok) {
    console.log(`  deleted ${r.id}`);
  } else if (r.skipped) {
    skipped += 1;
    console.log(`  skipped ${r.id} reason=${r.reason}`);
  } else {
    failed += 1;
    console.error(`  failed ${r.id}: ${r.error || r.code}`);
  }
}

console.log(`Done. purged=${purged} skipped=${skipped} failed=${failed}`);
process.exit(failed ? 1 : 0);
