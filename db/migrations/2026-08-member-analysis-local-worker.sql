-- Phase M3-L — Local Qwen Worker queue columns (member_analysis_runs)
-- 既存 2026-08-member-qualitative-profile.sql は変更しない。Neon へ別途適用。

ALTER TABLE member_analysis_runs
  ADD COLUMN IF NOT EXISTS worker_id TEXT NULL,
  ADD COLUMN IF NOT EXISTS claim_token UUID NULL,
  ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_member_analysis_runs_status_created
  ON member_analysis_runs (status, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_member_analysis_runs_lease
  ON member_analysis_runs (lease_expires_at)
  WHERE status = 'running';
