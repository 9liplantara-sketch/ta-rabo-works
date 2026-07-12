-- Migration: students テーブルに表示用カラムと在籍管理カラムを追加する
-- 既存の Neon DB に対して Neon SQL Editor にそのまま貼り付けて一度だけ実行する。
-- すべて IF NOT EXISTS / DROP IF EXISTS を使っており、何度実行しても安全（冪等）。
-- 新規構築の場合は db/schema.sql に統合済みなので実行不要。

-- 表示・メモ・アクセント色
ALTER TABLE students ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE students ADD COLUMN IF NOT EXISTS note         TEXT;
ALTER TABLE students ADD COLUMN IF NOT EXISTS icon_color   TEXT;

-- 在籍・タイムスタンプ（古いスキーマで欠けている場合に備えて追加）
ALTER TABLE students ADD COLUMN IF NOT EXISTS enrolled_at  DATE;
ALTER TABLE students ADD COLUMN IF NOT EXISTS is_active    BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE students ADD COLUMN IF NOT EXISTS created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE students ADD COLUMN IF NOT EXISTS updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- updated_at 自動更新トリガー（関数・トリガーとも再作成して冪等にする）
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $fn$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_students_updated_at ON students;
CREATE TRIGGER trg_students_updated_at
  BEFORE UPDATE ON students
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 検索用インデックス（存在しなければ作成）
CREATE INDEX IF NOT EXISTS idx_students_email ON students (email);
CREATE INDEX IF NOT EXISTS idx_students_role ON students (role);
