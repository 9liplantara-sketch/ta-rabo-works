-- Phase 2: psych_assessments.item_answers（恒久 item_id → 回答）
--
-- Neon SQL Editor で手動実行（本番適用はユーザー確認後）。
-- 冪等: ADD COLUMN IF NOT EXISTS
-- 既存 v1 行は item_answers = NULL のまま（backfill しない）

ALTER TABLE psych_assessments
  ADD COLUMN IF NOT EXISTS item_answers JSONB;

COMMENT ON COLUMN psych_assessments.item_answers IS
  'Phase 2: 恒久 item_id キーの回答 JSON。v1 行は NULL。v3 同期時のみ設定。採点は Phase 3。';
