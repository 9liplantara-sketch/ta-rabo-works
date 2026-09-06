-- Phase 6B: consent_records (local_ai_analysis canonical store)
-- Apply order (local / future Production only — do NOT apply in Phase 6B session):
--   1) 2026-09-member-qualitative-intake-evidence.sql      (Phase 6A)
--   2) 2026-09-member-local-ai-consent.sql                 (Phase 6B)
--   3) 2026-09-member-profile-evidence-source-id-text.sql  (Phase 6C)
-- Depends on: students(id)
-- Does NOT auto-derive consent from psych_assessments.item_answers / Form answers.

CREATE TABLE IF NOT EXISTS consent_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES students (id) ON DELETE CASCADE,
  consent_type TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  status TEXT NOT NULL,
  consented_at TIMESTAMPTZ NOT NULL,
  withdrawn_at TIMESTAMPTZ,
  source TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT consent_records_consent_type_check CHECK (
    consent_type IN (
      'operational_use',
      'local_ai_analysis',
      'longitudinal_research',
      'post_graduation_contact'
    )
  ),
  CONSTRAINT consent_records_status_check CHECK (
    status IN ('active', 'withdrawn')
  ),
  CONSTRAINT consent_records_source_check CHECK (
    source IN ('admin_recorded', 'student_form', 'migration')
  ),
  CONSTRAINT consent_records_status_withdrawn_at_check CHECK (
    (status = 'active' AND withdrawn_at IS NULL)
    OR (status = 'withdrawn' AND withdrawn_at IS NOT NULL)
  ),
  CONSTRAINT consent_records_policy_version_nonempty_check CHECK (
    length(trim(policy_version)) > 0
  )
);

-- One active episode per student + consent_type; withdrawn history retained
CREATE UNIQUE INDEX IF NOT EXISTS idx_consent_records_student_type_active_unique
  ON consent_records (student_id, consent_type)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_consent_records_student_type_status
  ON consent_records (student_id, consent_type, status);

DROP TRIGGER IF EXISTS trg_consent_records_updated_at ON consent_records;
CREATE TRIGGER trg_consent_records_updated_at
  BEFORE UPDATE ON consent_records
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
