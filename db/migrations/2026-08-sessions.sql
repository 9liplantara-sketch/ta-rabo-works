-- Phase 2a: Session 基盤（Sheets → Neon sync 用）
CREATE TABLE IF NOT EXISTS sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type          TEXT NOT NULL
                CHECK (type IN ('seminar', 'lesson', 'meeting')),
  title         TEXT,
  session_no    INTEGER,
  session_date  DATE NOT NULL,
  starts_at     TIMESTAMPTZ,
  ends_at       TIMESTAMPTZ,
  status        TEXT NOT NULL DEFAULT 'scheduled'
                CHECK (status IN ('scheduled', 'cancelled', 'completed')),
  source        TEXT NOT NULL,
  source_key    TEXT NOT NULL,
  place         TEXT,
  preparations  TEXT,
  submissions   TEXT,
  note          TEXT,
  event_subtype TEXT,
  metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source, source_key)
);

CREATE INDEX IF NOT EXISTS idx_sessions_date ON sessions (session_date DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_type_date ON sessions (type, session_date DESC);

DROP TRIGGER IF EXISTS trg_sessions_updated_at ON sessions;
CREATE TRIGGER trg_sessions_updated_at
  BEFORE UPDATE ON sessions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
