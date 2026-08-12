/**
 * GAS sync 判定ロジック（Node テスト用 mirror）
 * gas/member-analysis-sync/Code.gs の evaluateSyncNeed_ と同仕様
 */

export const SYNC_STATUS_SYNCED = 'synced';
export const SYNC_STATUS_ERROR = 'error';

/**
 * 次回 sync 対象:
 * - sync_id なし
 * - sync_status != synced（error / 空 / pending 含む）
 * - hash 変更（synced でも内容変更時）
 */
export function evaluateSyncNeed({ syncId, status, storedHash, newHash }) {
  const id = String(syncId || '').trim();
  const st = String(status || '').trim();
  const stored = String(storedHash || '').trim();
  const hash = String(newHash || '').trim();

  if (!id) {
    return { needsSync: true, assignSyncId: true, reason: 'new' };
  }

  if (st !== SYNC_STATUS_SYNCED) {
    return {
      needsSync: true,
      reason: st === SYNC_STATUS_ERROR ? 'retry_error' : 'not_synced',
    };
  }

  if (stored && stored === hash) {
    return { needsSync: false, reason: 'unchanged' };
  }

  return { needsSync: true, reason: 'changed' };
}
