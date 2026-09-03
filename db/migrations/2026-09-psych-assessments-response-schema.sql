-- Phase 5E: psych_assessments dual schema / historical response guard
--
-- Neon SQL Editor で手動実行（本番適用はユーザー確認後）。
-- 冪等: ADD COLUMN IF NOT EXISTS + guarded backfill + final ASSERT
--
-- 絶対に変更しない: student_id, respondent_*, raw_answers, item_answers,
-- scores, sync hash 相当, academic_year, source_response_id, answered_at

ALTER TABLE psych_assessments
  ADD COLUMN IF NOT EXISTS response_schema_version TEXT;

ALTER TABLE psych_assessments
  ADD COLUMN IF NOT EXISTS source_layout_hash TEXT;

COMMENT ON COLUMN psych_assessments.response_schema_version IS
  'Phase 5E: physical/semantic response schema (legacy-physical-v1 | semantic-itemid-v3). Independent of questionnaire_version.';

COMMENT ON COLUMN psych_assessments.source_layout_hash IS
  'Phase 5E: sheet-layout-v1:<sha256> fingerprint of Form answer header sequence (order-preserving).';

-- NOTE: source_layout_hash は migration では埋めない（NULL のまま）。
-- Sheet bootstrap（semantic のみ）→ 次回 semantic sync で NULL→fill。
-- legacy 3件は schema のみ backfillし、layout hash は付けない。

-- Historical legacy 3 rows — explicit sync_id only + scoring/item_answers guards
UPDATE psych_assessments
SET response_schema_version = 'legacy-physical-v1'
WHERE source = 'google_forms_sheet'
  AND source_response_id IN (
    'c17c3da7-00e5-40f2-8947-faa77b94238a',
    'f675e458-7ac1-4c75-9cf8-523e676e614c',
    '4d890e1d-8c6a-4b45-8b16-cd823e2c768d'
  )
  AND scoring_version = 'member-analysis-score-v1'
  AND (
    item_answers IS NULL
    OR item_answers = '{}'::jsonb
    OR COALESCE(jsonb_typeof(item_answers), '') = 'null'
    OR (
      jsonb_typeof(item_answers) = 'object'
      AND (SELECT COUNT(*) FROM jsonb_object_keys(item_answers)) = 0
    )
  )
  AND response_schema_version IS NULL;

-- Current semantic v3 row — explicit sync_id + scoring/item_answers guards
UPDATE psych_assessments
SET response_schema_version = 'semantic-itemid-v3'
WHERE source = 'google_forms_sheet'
  AND source_response_id = 'bfc6feeb-25e4-4b64-9dcf-232c2f83c0a6'
  AND scoring_version = 'member-analysis-score-v3'
  AND item_answers IS NOT NULL
  AND jsonb_typeof(item_answers) = 'object'
  AND (SELECT COUNT(*) FROM jsonb_object_keys(item_answers)) = 118
  AND response_schema_version IS NULL;

-- Fail closed: expected classification must hold after backfill
DO $$
DECLARE
  legacy_ok INTEGER;
  legacy_missing_or_wrong INTEGER;
  v3_ok INTEGER;
  v3_missing_or_wrong INTEGER;
BEGIN
  SELECT COUNT(*) INTO legacy_ok
  FROM psych_assessments
  WHERE source = 'google_forms_sheet'
    AND source_response_id IN (
      'c17c3da7-00e5-40f2-8947-faa77b94238a',
      'f675e458-7ac1-4c75-9cf8-523e676e614c',
      '4d890e1d-8c6a-4b45-8b16-cd823e2c768d'
    )
    AND response_schema_version = 'legacy-physical-v1';

  SELECT COUNT(*) INTO legacy_missing_or_wrong
  FROM psych_assessments
  WHERE source = 'google_forms_sheet'
    AND source_response_id IN (
      'c17c3da7-00e5-40f2-8947-faa77b94238a',
      'f675e458-7ac1-4c75-9cf8-523e676e614c',
      '4d890e1d-8c6a-4b45-8b16-cd823e2c768d'
    )
    AND response_schema_version IS DISTINCT FROM 'legacy-physical-v1';

  IF legacy_ok <> 3 OR legacy_missing_or_wrong <> 0 THEN
    RAISE EXCEPTION
      'Phase 5E legacy backfill failed: expected 3 legacy-physical-v1 rows, got ok=% wrong=%',
      legacy_ok, legacy_missing_or_wrong;
  END IF;

  SELECT COUNT(*) INTO v3_ok
  FROM psych_assessments
  WHERE source = 'google_forms_sheet'
    AND source_response_id = 'bfc6feeb-25e4-4b64-9dcf-232c2f83c0a6'
    AND response_schema_version = 'semantic-itemid-v3';

  SELECT COUNT(*) INTO v3_missing_or_wrong
  FROM psych_assessments
  WHERE source = 'google_forms_sheet'
    AND source_response_id = 'bfc6feeb-25e4-4b64-9dcf-232c2f83c0a6'
    AND response_schema_version IS DISTINCT FROM 'semantic-itemid-v3';

  IF v3_ok <> 1 OR v3_missing_or_wrong <> 0 THEN
    RAISE EXCEPTION
      'Phase 5E semantic backfill failed: expected 1 semantic-itemid-v3 row, got ok=% wrong=%',
      v3_ok, v3_missing_or_wrong;
  END IF;
END $$;
