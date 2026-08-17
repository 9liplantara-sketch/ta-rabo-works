-- Phase M3: 管理者限定 · AI定性メンバープロフィール
-- Neon SQL Editor で手動実行（本番はユーザー確認後）。
-- 冪等: IF NOT EXISTS

CREATE TABLE IF NOT EXISTS member_analysis_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  student_id UUID NOT NULL
    REFERENCES students (id)
    ON DELETE CASCADE,

  window_start TIMESTAMPTZ NOT NULL,
  window_end TIMESTAMPTZ NOT NULL,

  source_count INTEGER NOT NULL DEFAULT 0,
  daily_report_count INTEGER NOT NULL DEFAULT 0,
  knowledge_record_count INTEGER NOT NULL DEFAULT 0,

  psych_assessment_id UUID
    REFERENCES psych_assessments (id)
    ON DELETE SET NULL,

  model_provider TEXT,
  model_name TEXT,
  prompt_version TEXT NOT NULL,

  status TEXT NOT NULL DEFAULT 'pending',

  created_candidates INTEGER NOT NULL DEFAULT 0,

  input_fingerprint TEXT,

  error_text TEXT,

  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT member_analysis_runs_status_check CHECK (
    status IN ('pending', 'running', 'completed', 'failed')
  )
);

CREATE INDEX IF NOT EXISTS idx_member_analysis_runs_student_created
  ON member_analysis_runs (student_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_member_analysis_runs_status
  ON member_analysis_runs (status);


CREATE TABLE IF NOT EXISTS member_profile_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  student_id UUID NOT NULL
    REFERENCES students (id)
    ON DELETE CASCADE,

  category TEXT NOT NULL,

  statement TEXT NOT NULL,

  epistemic_type TEXT NOT NULL,

  confidence TEXT NOT NULL,

  status TEXT NOT NULL DEFAULT 'candidate',

  related_item_id UUID
    REFERENCES member_profile_items (id)
    ON DELETE SET NULL,

  relation_type TEXT,

  supersedes_id UUID
    REFERENCES member_profile_items (id)
    ON DELETE SET NULL,

  first_observed_at TIMESTAMPTZ,
  last_observed_at TIMESTAMPTZ,

  analysis_run_id UUID
    REFERENCES member_analysis_runs (id)
    ON DELETE SET NULL,

  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT member_profile_items_category_check CHECK (
    category IN (
      'interest', 'preference', 'aversion', 'strength', 'difficulty',
      'work_style', 'communication', 'motivation', 'goal', 'concern',
      'recent_change', 'other'
    )
  ),

  CONSTRAINT member_profile_items_epistemic_type_check CHECK (
    epistemic_type IN ('self_report', 'observed_pattern', 'ai_hypothesis')
  ),

  CONSTRAINT member_profile_items_confidence_check CHECK (
    confidence IN ('low', 'medium', 'high')
  ),

  CONSTRAINT member_profile_items_status_check CHECK (
    status IN ('candidate', 'confirmed', 'superseded', 'rejected')
  ),

  CONSTRAINT member_profile_items_relation_type_check CHECK (
    relation_type IS NULL OR relation_type IN (
      'new', 'reinforce', 'contradict', 'possible_supersede'
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_member_profile_items_student_status
  ON member_profile_items (student_id, status);

CREATE INDEX IF NOT EXISTS idx_member_profile_items_student_category
  ON member_profile_items (student_id, category);

CREATE INDEX IF NOT EXISTS idx_member_profile_items_run
  ON member_profile_items (analysis_run_id)
  WHERE analysis_run_id IS NOT NULL;


CREATE TABLE IF NOT EXISTS member_profile_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  profile_item_id UUID NOT NULL
    REFERENCES member_profile_items (id)
    ON DELETE CASCADE,

  source_kind TEXT NOT NULL,

  source_id UUID NOT NULL,

  evidence_role TEXT NOT NULL DEFAULT 'supports',

  observed_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT member_profile_evidence_source_kind_check CHECK (
    source_kind IN ('daily_report', 'knowledge_record')
  ),

  CONSTRAINT member_profile_evidence_role_check CHECK (
    evidence_role IN ('supports', 'contradicts')
  )
);

CREATE INDEX IF NOT EXISTS idx_member_profile_evidence_item
  ON member_profile_evidence (profile_item_id);

CREATE INDEX IF NOT EXISTS idx_member_profile_evidence_source
  ON member_profile_evidence (source_kind, source_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_member_profile_evidence_unique
  ON member_profile_evidence (profile_item_id, source_kind, source_id, evidence_role);


DROP TRIGGER IF EXISTS trg_member_profile_items_updated_at ON member_profile_items;
CREATE TRIGGER trg_member_profile_items_updated_at
  BEFORE UPDATE ON member_profile_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
