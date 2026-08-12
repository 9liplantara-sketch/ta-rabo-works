-- Phase 2a: 日報と Google Sheets session_key の紐づけ
-- 予定本体は Sheets 正本。Neon には参照 ID のみ保持（FK なし）。

ALTER TABLE daily_reports
  ADD COLUMN IF NOT EXISTS session_key TEXT;

CREATE INDEX IF NOT EXISTS idx_daily_reports_session_key
  ON daily_reports (session_key);

COMMENT ON COLUMN daily_reports.session_key IS
  'Google Sheets 上の session_key への参照。予定本体は Sheets 正本。';
