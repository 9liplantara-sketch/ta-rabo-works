-- Phase K1: 研究室の知見 — 共有記録（議事録・文字起こし等）
-- Neon SQL Editor で手動実行（本番はユーザー確認後）。
-- 冪等: IF NOT EXISTS

CREATE TABLE IF NOT EXISTS knowledge_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  record_type TEXT NOT NULL,
  title TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  session_key TEXT,

  body_text TEXT NOT NULL,
  summary_text TEXT,
  decisions_text TEXT,
  next_actions_text TEXT,

  visibility TEXT NOT NULL DEFAULT 'lab',
  created_by TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT knowledge_records_record_type_check CHECK (
    record_type IN (
      'meeting_minutes',
      'transcript',
      'one_on_one',
      'interview',
      'admin_note',
      'other'
    )
  ),

  CONSTRAINT knowledge_records_visibility_check CHECK (
    visibility IN ('lab', 'admin')
  )
);

CREATE INDEX IF NOT EXISTS idx_knowledge_records_occurred_at
  ON knowledge_records (occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_knowledge_records_record_type
  ON knowledge_records (record_type);

CREATE INDEX IF NOT EXISTS idx_knowledge_records_session_key
  ON knowledge_records (session_key)
  WHERE session_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS knowledge_record_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  record_id UUID NOT NULL
    REFERENCES knowledge_records (id)
    ON DELETE CASCADE,

  student_id UUID
    REFERENCES students (id)
    ON DELETE SET NULL,

  participant_name TEXT NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_record_participants_record
  ON knowledge_record_participants (record_id);

CREATE INDEX IF NOT EXISTS idx_knowledge_record_participants_student
  ON knowledge_record_participants (student_id)
  WHERE student_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_record_participants_record_student
  ON knowledge_record_participants (record_id, student_id)
  WHERE student_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_knowledge_records_updated_at ON knowledge_records;
CREATE TRIGGER trg_knowledge_records_updated_at
  BEFORE UPDATE ON knowledge_records
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE knowledge_records IS
  'Phase K1: 研究室共有記録（議事録・文字起こし等）。日報は daily_reports を動的参照しコピーしない。';

COMMENT ON TABLE knowledge_record_participants IS
  'knowledge_records と参加メンバーの many-to-many。participant_name はスナップショット。';
