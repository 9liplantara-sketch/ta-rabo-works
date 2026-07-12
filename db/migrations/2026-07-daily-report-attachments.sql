-- Migration: daily_reports に制作物・画像リンクの複数保存用カラム attachments を追加する
-- 既存の Neon DB に対して Neon SQL Editor にそのまま貼り付けて一度だけ実行する。
-- IF NOT EXISTS を使っており、何度実行しても安全（冪等）。
-- 新規構築の場合は db/schema.sql に統合済みなので実行不要。
--
-- attachments は各要素が { title, url, type, note } の JSON 配列。
--   title : リンクの見出し（任意）
--   url   : Google Drive 等の URL（http/https）
--   type  : image / pdf / video / other
--   note  : 補足説明（任意）
-- 既存の単一 drive_link カラムはそのまま残す（互換のため削除しない）。

ALTER TABLE daily_reports
  ADD COLUMN IF NOT EXISTS attachments JSONB NOT NULL DEFAULT '[]'::jsonb;
