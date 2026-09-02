-- Phase 5A: psych_assessments.academic_year（収集年度）
--
-- Neon SQL Editor で手動実行（本番適用はユーザー確認後）。
-- 冪等: ADD COLUMN IF NOT EXISTS
-- NOT NULL は付けない（Member Analysis 以外の row / legacy 互換 / 段階適用）

ALTER TABLE psych_assessments
  ADD COLUMN IF NOT EXISTS academic_year INTEGER;

COMMENT ON COLUMN psych_assessments.academic_year IS
  'Phase 5A: 収集年度（collection cycle）。questionnaire_version とは独立。v3 sync では必須。';

-- Member Analysis 2026 既存 row の明示 backfill（answered_at 推定は使わない）
UPDATE psych_assessments
SET academic_year = 2026
WHERE questionnaire_version IN (
  'member-analysis-2026-v1',
  'member-analysis-2026-v3'
)
AND academic_year IS NULL;
