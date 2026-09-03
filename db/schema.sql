-- ta_rabo lab manager - Neon Postgres schema
-- Paste this entire file into Neon SQL Editor and run once.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS students (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  -- email は任意（NULL 可）。メールがまだ分からない学生を名簿・進捗枠として先に登録できる。
  -- UNIQUE は複数 NULL を許容するため、メール未設定の学生を複数登録できる。
  email         TEXT UNIQUE,
  role          TEXT NOT NULL DEFAULT 'student'
                CHECK (role IN ('student', 'admin')),
  -- 軽微な表示用属性（過剰に複雑にしない）
  display_name  TEXT,           -- 本人が設定する表示名（未設定なら name を使う）
  note          TEXT,           -- 教員用のメモ
  icon_color    TEXT,           -- 一覧表示のアクセント色（#RRGGBB）
  enrolled_at   DATE,
  -- is_active     … 在籍・表示状態（名簿や進捗枠として存在するか）
  -- login_enabled … ログイン許可（田羅が承認した人だけが日報・進捗を使える）。
  --                 Google ログイン成功だけでは使えないよう、既定は false。
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  login_enabled BOOLEAN NOT NULL DEFAULT FALSE,
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
  -- Google Sheets 上の session_key への参照（予定本体は Sheets 正本。FK なし）
  session_key     TEXT,
  drive_link      TEXT,
  -- 制作物・画像などの複数リンク。ファイル本体は Google Drive 等に置き、ここには URL と
  -- 説明のみを保存する。各要素は { title, url, type(image/pdf/video/other), note } 形式。
  -- 既存の単一 drive_link は互換のため残す。将来 Vercel Blob へ拡張する余地を持たせる。
  attachments     JSONB NOT NULL DEFAULT '[]'::jsonb,
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
CREATE INDEX IF NOT EXISTS idx_daily_reports_student_date ON daily_reports (student_email, report_date DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_daily_reports_visibility ON daily_reports (visibility);
CREATE INDEX IF NOT EXISTS idx_daily_reports_session_key ON daily_reports (session_key);

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

-- メンバー分析: Google Form 回答の採点結果（生回答正本は Google Sheets）
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

  -- Phase 2: 恒久 item_id → 回答（v1 行は NULL。backfill しない）
  item_answers JSONB,

  -- Phase 5A: 収集年度（collection cycle）。questionnaire_version とは独立
  academic_year INTEGER,

  -- Phase 5E: physical/semantic response schema（questionnaire_version とは独立）
  response_schema_version TEXT,
  source_layout_hash TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (source, source_response_id)
);

CREATE INDEX IF NOT EXISTS idx_psych_assessments_student_date
  ON psych_assessments (student_id, answered_at DESC);

CREATE INDEX IF NOT EXISTS idx_psych_assessments_source_response
  ON psych_assessments (source, source_response_id);

-- Phase K1: 研究室の知見 — 共有記録（日報は daily_reports を動的参照・コピーしない）
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

-- Phase M3: 管理者限定 · AI定性メンバープロフィール
CREATE TABLE IF NOT EXISTS member_analysis_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES students (id) ON DELETE CASCADE,
  window_start TIMESTAMPTZ NOT NULL,
  window_end TIMESTAMPTZ NOT NULL,
  source_count INTEGER NOT NULL DEFAULT 0,
  daily_report_count INTEGER NOT NULL DEFAULT 0,
  knowledge_record_count INTEGER NOT NULL DEFAULT 0,
  psych_assessment_id UUID REFERENCES psych_assessments (id) ON DELETE SET NULL,
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
  worker_id TEXT NULL,
  claim_token UUID NULL,
  claimed_at TIMESTAMPTZ NULL,
  lease_expires_at TIMESTAMPTZ NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT member_analysis_runs_status_check CHECK (
    status IN ('pending', 'running', 'completed', 'failed')
  )
);

CREATE INDEX IF NOT EXISTS idx_member_analysis_runs_student_created
  ON member_analysis_runs (student_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_member_analysis_runs_status_created
  ON member_analysis_runs (status, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_member_analysis_runs_lease
  ON member_analysis_runs (lease_expires_at)
  WHERE status = 'running';

CREATE TABLE IF NOT EXISTS member_profile_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES students (id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  statement TEXT NOT NULL,
  epistemic_type TEXT NOT NULL,
  confidence TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'candidate',
  related_item_id UUID REFERENCES member_profile_items (id) ON DELETE SET NULL,
  relation_type TEXT,
  supersedes_id UUID REFERENCES member_profile_items (id) ON DELETE SET NULL,
  first_observed_at TIMESTAMPTZ,
  last_observed_at TIMESTAMPTZ,
  analysis_run_id UUID REFERENCES member_analysis_runs (id) ON DELETE SET NULL,
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

CREATE TABLE IF NOT EXISTS member_profile_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_item_id UUID NOT NULL REFERENCES member_profile_items (id) ON DELETE CASCADE,
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

CREATE UNIQUE INDEX IF NOT EXISTS idx_member_profile_evidence_unique
  ON member_profile_evidence (profile_item_id, source_kind, source_id, evidence_role);

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

DROP TRIGGER IF EXISTS trg_psych_assessments_updated_at ON psych_assessments;
CREATE TRIGGER trg_psych_assessments_updated_at
  BEFORE UPDATE ON psych_assessments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_knowledge_records_updated_at ON knowledge_records;
CREATE TRIGGER trg_knowledge_records_updated_at
  BEFORE UPDATE ON knowledge_records
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_member_profile_items_updated_at ON member_profile_items;
CREATE TRIGGER trg_member_profile_items_updated_at
  BEFORE UPDATE ON member_profile_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
