-- Phase 6C: member_profile_evidence.source_id UUID → TEXT
-- Classification: non-destructive type widening (existing UUID values preserved as text)
-- Apply order (local / future Production only — do NOT apply in this session):
--   1) 2026-09-member-qualitative-intake-evidence.sql   (Phase 6A)
--   2) 2026-09-member-local-ai-consent.sql              (Phase 6B)
--   3) 2026-09-member-profile-evidence-source-id-text.sql (Phase 6C)
--
-- Why: intake_response evidence IDs are `${assessmentId}:${itemId}` (non-UUID).
-- daily_report / knowledge_record continue to store UUID strings.
-- No DELETE / no row rewrite beyond type cast. No FK on source_id.

ALTER TABLE member_profile_evidence
  ALTER COLUMN source_id TYPE TEXT
  USING source_id::text;
