-- 日報画像 Preview 用の架空シード（実学生データ禁止）
-- 前提: schema.sql + migrations（attachments / session_key / 2026-11-daily-report-media.sql）適用済みの空 DB
-- Neon schema-only branch または新規空プロジェクトに対して実行する

-- 固定 UUID（検証手順で参照しやすいように）
-- teacher: aaaaaaaa-1111-4111-8111-111111111111
-- studentA: bbbbbbbb-2222-4222-8222-222222222222
-- studentB: cccccccc-3333-4333-8333-333333333333

INSERT INTO students (
  id, name, email, role, display_name, note, icon_color,
  enrolled_at, is_active, login_enabled
) VALUES
  (
    'aaaaaaaa-1111-4111-8111-111111111111'::uuid,
    'Preview Teacher',
    'preview-teacher@example.com',
    'admin',
    '検証教員',
    'preview seed — fictional',
    '#c9a227',
    CURRENT_DATE,
    TRUE,
    TRUE
  ),
  (
    'bbbbbbbb-2222-4222-8222-222222222222'::uuid,
    'Preview Student A',
    'preview-student-a@example.com',
    'student',
    '検証学生A',
    'preview seed — fictional',
    '#4a90d9',
    CURRENT_DATE,
    TRUE,
    TRUE
  ),
  (
    'cccccccc-3333-4333-8333-333333333333'::uuid,
    'Preview Student B',
    'preview-student-b@example.com',
    'student',
    '検証学生B',
    'preview seed — fictional',
    '#6aab6a',
    CURRENT_DATE,
    TRUE,
    TRUE
  )
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  email = EXCLUDED.email,
  role = EXCLUDED.role,
  display_name = EXCLUDED.display_name,
  login_enabled = TRUE,
  is_active = TRUE;

-- 日報サンプル（画像なし。アップロードは UI から追加）
INSERT INTO daily_reports (
  id, report_date, student_id, student_name, student_email,
  did_today, went_well, stuck_points, next_action, related_project,
  attachments, visibility
) VALUES
  (
    'dddddddd-4444-4444-8444-444444444401'::uuid,
    CURRENT_DATE,
    'bbbbbbbb-2222-4222-8222-222222222222'::uuid,
    '検証学生A',
    'preview-student-a@example.com',
    'Preview: 実験ノートの下書きを書いた（架空）。',
    '下書きが短くまとまった',
    NULL,
    '写真を1枚添付して再保存する',
    'preview-theme',
    '[]'::jsonb,
    'private'
  ),
  (
    'dddddddd-4444-4444-8444-444444444402'::uuid,
    CURRENT_DATE - 1,
    'bbbbbbbb-2222-4222-8222-222222222222'::uuid,
    '検証学生A',
    'preview-student-a@example.com',
    'Preview: lab 共有用の作業メモ（架空）。',
    NULL,
    NULL,
    '共有範囲を確認する',
    'preview-theme',
    '[{"title":"Drive例","url":"https://example.com/preview-drive-link","type":"other","note":"URL添付の退行確認用"}]'::jsonb,
    'lab'
  )
ON CONFLICT (id) DO NOTHING;

-- 使い方メモ（SQLコメント）:
-- 1) Google OAuth で使う実メールは students.email を検証用 Gmail に UPDATE する
--    （example.com のままではログインできない）
-- 2) ADMIN_EMAILS に検証教員の実メールを Preview 環境変数だけに設定
-- 3) 検証後はこの branch / DB を削除し、BLOB 検証ストアも削除
