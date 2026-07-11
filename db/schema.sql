-- ta_rabo lab manager - Neon Postgres schema
-- Paste this entire file into Neon SQL Editor and run once.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS students (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  role          TEXT NOT NULL DEFAULT 'student'
                CHECK (role IN ('student', 'admin')),
  enrolled_at   DATE,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_students_email ON students (email);
CREATE INDEX IF NOT EXISTS idx_students_role ON students (role);

CREATE TABLE IF NOT EXISTS projects (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id    UUID NOT NULL REFERENCES students (id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  description   TEXT,
  status        TEXT NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'paused', 'completed', 'archived')),
  started_at    DATE,
  ended_at      DATE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_projects_student_id ON projects (student_id);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects (status);

CREATE TABLE IF NOT EXISTS seminar_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_date    DATE NOT NULL,
  start_time    TIME NOT NULL DEFAULT '13:00',
  end_time      TIME NOT NULL DEFAULT '15:00',
  type          TEXT NOT NULL,
  title         TEXT NOT NULL,
  description   TEXT,
  is_official   BOOLEAN NOT NULL DEFAULT FALSE,
  is_cancelled  BOOLEAN NOT NULL DEFAULT FALSE,
  timezone      TEXT NOT NULL DEFAULT 'Asia/Tokyo',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_seminar_events_date ON seminar_events (event_date);
CREATE INDEX IF NOT EXISTS idx_seminar_events_type ON seminar_events (type);
CREATE INDEX IF NOT EXISTS idx_seminar_events_official ON seminar_events (is_official);

CREATE TABLE IF NOT EXISTS daily_reports (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_date     DATE NOT NULL,
  student_id      UUID REFERENCES students (id) ON DELETE SET NULL,
  student_name    TEXT NOT NULL,
  student_email   TEXT NOT NULL,
  did_today       TEXT NOT NULL,
  went_well       TEXT,
  stuck_points    TEXT,
  next_action     TEXT,
  related_project TEXT,
  drive_link      TEXT,
  time_spent      TEXT,
  work_location   TEXT,
  -- visibility は学生の日報の公開範囲を制御する。
  --   private : 本人と教員のみ
  --   lab     : 研究室メンバー全員に共有
  --   public  : 将来的に公開可能
  -- 個人情報や悩みが含まれる可能性があるため、初期値は private とする。
  visibility      TEXT NOT NULL DEFAULT 'private'
                  CHECK (visibility IN ('private', 'lab', 'public')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_daily_reports_date ON daily_reports (report_date DESC);
CREATE INDEX IF NOT EXISTS idx_daily_reports_student_email ON daily_reports (student_email);
CREATE INDEX IF NOT EXISTS idx_daily_reports_visibility ON daily_reports (visibility);

CREATE TABLE IF NOT EXISTS material_guides (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  material_name   TEXT NOT NULL,
  category        TEXT,
  use_case        TEXT,
  how_to_use      TEXT,
  cautions        TEXT,
  reference_url   TEXT,
  image_url       TEXT,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  is_published    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_material_guides_category ON material_guides (category);
CREATE INDEX IF NOT EXISTS idx_material_guides_published ON material_guides (is_published);

CREATE TABLE IF NOT EXISTS student_progress (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id        UUID REFERENCES students (id) ON DELETE SET NULL,
  student_name      TEXT NOT NULL,
  student_email     TEXT NOT NULL,
  project_id        UUID REFERENCES projects (id) ON DELETE SET NULL,
  research_theme    TEXT,
  monthly_output    TEXT,
  next_task         TEXT,
  status            TEXT NOT NULL DEFAULT 'in_progress'
                    CHECK (status IN ('not_started', 'in_progress', 'review', 'blocked', 'done')),
  last_reviewed_at  TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_student_progress_email ON student_progress (student_email);
CREATE INDEX IF NOT EXISTS idx_student_progress_status ON student_progress (status);
CREATE INDEX IF NOT EXISTS idx_student_progress_reviewed ON student_progress (last_reviewed_at DESC);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $fn$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_students_updated_at ON students;
CREATE TRIGGER trg_students_updated_at
  BEFORE UPDATE ON students
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_projects_updated_at ON projects;
CREATE TRIGGER trg_projects_updated_at
  BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_seminar_events_updated_at ON seminar_events;
CREATE TRIGGER trg_seminar_events_updated_at
  BEFORE UPDATE ON seminar_events
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_daily_reports_updated_at ON daily_reports;
CREATE TRIGGER trg_daily_reports_updated_at
  BEFORE UPDATE ON daily_reports
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_material_guides_updated_at ON material_guides;
CREATE TRIGGER trg_material_guides_updated_at
  BEFORE UPDATE ON material_guides
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_student_progress_updated_at ON student_progress;
CREATE TRIGGER trg_student_progress_updated_at
  BEFORE UPDATE ON student_progress
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
