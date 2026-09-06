-- Phase 6A: allow intake_response evidence references (no body duplication)
-- Local / future apply only. Do NOT run on Production in Phase 6A/6B session.
-- Apply order:
--   1) this file (Phase 6A)
--   2) 2026-09-member-local-ai-consent.sql (Phase 6B)
--   3) 2026-09-member-profile-evidence-source-id-text.sql (Phase 6C)

ALTER TABLE member_profile_evidence
  DROP CONSTRAINT IF EXISTS member_profile_evidence_source_kind_check;

ALTER TABLE member_profile_evidence
  ADD CONSTRAINT member_profile_evidence_source_kind_check CHECK (
    source_kind IN ('daily_report', 'knowledge_record', 'intake_response')
  );
