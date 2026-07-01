-- 例: Neon SQL Editor で students を登録（メールは実際の Google アカウントに置き換え）
-- 教員は ADMIN_EMAILS 環境変数でもログイン可能

INSERT INTO students (name, email, role) VALUES
  ('学生1', 'student1@example.com', 'student'),
  ('学生2', 'student2@example.com', 'student')
ON CONFLICT (email) DO NOTHING;

-- 既存テーブルに drive_link を後から足す場合:
-- ALTER TABLE daily_reports ADD COLUMN IF NOT EXISTS drive_link TEXT;
