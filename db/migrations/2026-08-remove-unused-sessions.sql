-- Phase 2a: 未使用 sessions テーブルの削除
-- 前提: sessions にデータなし、コード側の依存削除済み
-- 本番適用: Step B–G デプロイ + Smoke Test 成功後に実行

DROP TRIGGER IF EXISTS trg_sessions_updated_at ON sessions;
DROP TABLE IF EXISTS sessions;
