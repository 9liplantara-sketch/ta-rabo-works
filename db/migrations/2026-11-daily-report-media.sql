-- Migration: 日報の直接画像アップロード用メタデータ
-- ファイル本体は Vercel Blob（private）。Neon には参照と権限紐用の行のみ。
-- Neon SQL Editor で手動実行（本番はユーザー確認後）。
-- 冪等: IF NOT EXISTS

CREATE TABLE IF NOT EXISTS daily_report_media (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- 日報へ紐付く前は NULL（一時アップロード）
  report_id UUID REFERENCES daily_reports (id) ON DELETE SET NULL,

  -- 所有者（students.id）。未紐付け中の閲覧・削除は所有者のみ
  owner_student_id UUID NOT NULL REFERENCES students (id) ON DELETE CASCADE,
  owner_email TEXT NOT NULL,

  -- Blob 上の安定パス（有効期限付きURLではない）
  blob_pathname TEXT NOT NULL,
  thumb_pathname TEXT,

  content_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size > 0),
  width INTEGER,
  height INTEGER,
  original_filename TEXT,
  caption TEXT,

  -- クライアント再試行の重複防止（同一ユーザー内で一意）
  client_upload_key TEXT,

  -- 削除確保の世代。claim ごとに新規発行。古い処理の完了/失敗更新は token 一致時のみ
  delete_claim_token UUID,

  -- pending: 未紐付け / attached: 日報に紐付け済 / orphaned: 外された
  -- deleting: 削除処理中（原子的確保。添付確定不可）
  -- delete_failed: Blob 削除失敗（DB行は残し再試行可能）
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'attached', 'orphaned', 'deleting', 'delete_failed')),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT daily_report_media_blob_pathname_unique UNIQUE (blob_pathname)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_report_media_owner_upload_key
  ON daily_report_media (owner_student_id, client_upload_key)
  WHERE client_upload_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_daily_report_media_report
  ON daily_report_media (report_id)
  WHERE report_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_daily_report_media_owner_status
  ON daily_report_media (owner_student_id, status);

CREATE INDEX IF NOT EXISTS idx_daily_report_media_orphaned
  ON daily_report_media (status, updated_at)
  WHERE status IN ('orphaned', 'pending', 'delete_failed', 'deleting');

DROP TRIGGER IF EXISTS trg_daily_report_media_updated_at ON daily_report_media;
CREATE TRIGGER trg_daily_report_media_updated_at
  BEFORE UPDATE ON daily_report_media
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE daily_report_media IS
  '日報画像メタ。本体は Vercel Blob private。閲覧は紐付いた daily_reports.visibility に従う。';
