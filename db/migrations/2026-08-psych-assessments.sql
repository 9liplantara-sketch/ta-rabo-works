-- Phase M2: メンバー分析 — psych_assessments（Google Form 回答の採点結果）
--
-- Neon SQL Editor で手動実行（本番適用はユーザー確認後）。
-- 冪等: IF NOT EXISTS / DROP TRIGGER IF EXISTS

CREATE TABLE IF NOT EXISTS psych_assessments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  student_id UUID
    REFERENCES students(id)
    ON DELETE SET NULL,

  respondent_name TEXT,
  respondent_email TEXT,

  answered_at TIMESTAMPTZ NOT NULL,

  source TEXT NOT NULL,
  source_response_id TEXT NOT NULL,

  questionnaire_version TEXT NOT NULL,
  scoring_version TEXT NOT NULL,

  raw_answers JSONB NOT NULL DEFAULT '{}'::jsonb,
  scores JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (source, source_response_id)
);

CREATE INDEX IF NOT EXISTS idx_psych_assessments_student_date
  ON psych_assessments (student_id, answered_at DESC);

CREATE INDEX IF NOT EXISTS idx_psych_assessments_source_response
  ON psych_assessments (source, source_response_id);

COMMENT ON TABLE psych_assessments IS 'メンバー分析: Google Form 回答の採点結果（生回答正本は Google Sheets）';
COMMENT ON COLUMN psych_assessments.source_response_id IS 'Sheets member_analysis_sync_id（UUID）';
COMMENT ON COLUMN psych_assessments.raw_answers IS '同期時点の回答スナップショット（将来の再採点用）';

DROP TRIGGER IF EXISTS trg_psych_assessments_updated_at ON psych_assessments;
CREATE TRIGGER trg_psych_assessments_updated_at
  BEFORE UPDATE ON psych_assessments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
