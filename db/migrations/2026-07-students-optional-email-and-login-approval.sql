-- Migration: students の email を任意化し、ログイン許可フラグ login_enabled を追加する
-- 既存の Neon DB に対して Neon SQL Editor にそのまま貼り付けて一度だけ実行する。
-- すべて IF NOT EXISTS / IF EXISTS 系を使っており、何度実行しても安全（冪等）。
-- 新規構築の場合は db/schema.sql に統合済みなので実行不要。
--
-- ※ 重要 ※
--   API（api/lib/db.js / api/lib/auth.js / api/students.js）は login_enabled 列を参照する。
--   この migration を Neon で実行する前に本番へ push すると、本番 API が
--   「column students.login_enabled does not exist」で 500 になる可能性がある。
--   必ず先に Neon SQL Editor でこの migration を実行してから push すること。
--
-- 目的:
--   1. メールアドレスがまだ分からない学生を、名簿・進捗枠として先に登録できるようにする
--      （email を NULL 可能にする）。
--   2. Google ログイン成功だけでは使えないようにする。田羅が承認した人だけが使えるよう、
--      ログイン許可を login_enabled で明示的に管理する。
--
-- 運用の考え方:
--   is_active     … 在籍・表示状態（名簿や進捗枠として存在するか）
--   login_enabled … ログイン許可（ログインして日報・進捗を使えるか）
--   email が NULL の学生は、名簿には載るがログインはできない（login_enabled は false のまま）。

-- 1) email の NOT NULL 制約を外す（メール未設定の学生を登録できるようにする）
ALTER TABLE students ALTER COLUMN email DROP NOT NULL;

-- 2) ログイン許可フラグ。既定は false（Google ログイン成功だけでは使えない）
ALTER TABLE students ADD COLUMN IF NOT EXISTS login_enabled BOOLEAN NOT NULL DEFAULT FALSE;

-- 3) 既存のメール登録済み・在籍中の学生／管理者はログイン許可済みにする（従来どおり使えるように）。
--    メール未設定（NULL）の学生は login_enabled = false のまま。
UPDATE students
   SET login_enabled = TRUE
 WHERE email IS NOT NULL
   AND btrim(email) <> ''
   AND is_active = TRUE
   AND login_enabled = FALSE;

-- 4) 既存の主要アカウントは確実にログイン継続できるようにする（保険。大文字小文字を無視）。
UPDATE students
   SET login_enabled = TRUE, is_active = TRUE
 WHERE lower(email) IN ('9liplant.ara@gmail.com', 'wonderdesignlabo@gmail.com');

-- 5) email の一意性は UNIQUE のまま維持する。
--    Postgres の UNIQUE 制約／UNIQUE インデックスは複数の NULL を許容するため、
--    email UNIQUE のままでもメール未設定（NULL）の学生を複数登録できる
--    （NULL 同士は重複とみなされない）。したがって UNIQUE(email) の変更は不要。
--    idx_students_email（非ユニークの検索用インデックス）が無ければ作成する。
CREATE INDEX IF NOT EXISTS idx_students_email ON students (email);

-- 確認用（任意）: 実行後、以下で状態を確認できる。
--   SELECT name, email, role, is_active, login_enabled FROM students ORDER BY role DESC, name;
