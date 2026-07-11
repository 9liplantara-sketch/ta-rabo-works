-- Migration: daily_reports に日報項目を追加し、公開範囲の初期値を private に変更する
-- 既存の Neon DB に対して Neon SQL Editor で一度だけ実行する。
-- 新規構築の場合は db/schema.sql に統合済みなので実行不要。

-- 1. 追加カラム（存在しない場合のみ）
ALTER TABLE daily_reports ADD COLUMN IF NOT EXISTS went_well     TEXT;
ALTER TABLE daily_reports ADD COLUMN IF NOT EXISTS time_spent    TEXT;
ALTER TABLE daily_reports ADD COLUMN IF NOT EXISTS work_location TEXT;

-- 2. 公開範囲のデフォルトを private に変更
--    学生の日報には個人情報や悩みが含まれる可能性があるため、
--    明示的に共有しない限り本人と教員のみに限定する。
ALTER TABLE daily_reports ALTER COLUMN visibility SET DEFAULT 'private';

-- 3. CHECK 制約が無い場合に備えて再定義（存在すれば維持）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE table_name = 'daily_reports' AND column_name = 'visibility'
  ) THEN
    ALTER TABLE daily_reports
      ADD CONSTRAINT daily_reports_visibility_check
      CHECK (visibility IN ('private', 'lab', 'public'));
  END IF;
END $$;
