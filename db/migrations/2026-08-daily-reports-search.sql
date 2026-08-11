-- Phase 1.5: 日報一覧の student_email + 日付ソート用インデックス
CREATE INDEX IF NOT EXISTS idx_daily_reports_student_date
  ON daily_reports (student_email, report_date DESC, created_at DESC);
