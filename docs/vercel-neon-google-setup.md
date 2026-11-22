# Vercel + Neon + Google ログイン セットアップ手順

研究室マネージャーを **Neon（正本）+ Vercel API + Google ログイン** で動かすための手順です。

## 全体像

```text
lab_manager.html（GitHub Pages）
    ↓ Googleログイン / 日報 POST
Vercel API（同一リポジトリ ta-rabo-works）
    ↓ DATABASE_URL
Neon Postgres
```

ファイル（画像・PDF）は従来どおり **Google Drive** 等に置いて URL 添付できます。
日報への**直接画像アップロード**は **Vercel Blob（private）** に本体、Neon の `daily_report_media` に参照を保存します（有効期限付き URL は恒久保存先にしません）。

---

## 1. Neon

1. [Neon Console](https://console.neon.tech/) でプロジェクト作成
2. **SQL Editor** で [`db/schema.sql`](../db/schema.sql) の**ファイル全文**を貼り付けて実行
   （README や Markdown のコードブロックではなく、リポジトリの `db/schema.sql` を直接コピーすること）

```bash
# macOS: ファイル全文をクリップボードにコピー
pbcopy < db/schema.sql
```

3. [`db/seed-example.sql`](../db/seed-example.sql) を参考に、学生の **Google メール** を `students` テーブルに登録
4. **Connection string** をコピー → `DATABASE_URL`

`drive_link` 列を後から足す場合:

```sql
ALTER TABLE daily_reports ADD COLUMN IF NOT EXISTS drive_link TEXT;
```

---

## 2. Google Cloud（OAuth）

1. [Google Cloud Console](https://console.cloud.google.com/) でプロジェクト作成
2. **APIとサービス → OAuth 同意画面** を設定（内部 or 外部）
3. **認証情報 → OAuth 2.0 クライアント ID** を作成
   - アプリケーションの種類: **ウェブアプリケーション**
   - 承認済みのリダイレクト URI:
     - `https://<your-vercel-project>.vercel.app/api/auth/callback`
     - ローカル検証時: `http://localhost:3000/api/auth/callback`（`vercel dev` 使用時）
4. **クライアント ID** と **クライアント シークレット** を控える

---

## 3. Vercel

1. [Vercel](https://vercel.com/) で **Import Git Repository** → `9liplantara-sketch/ta-rabo-works`
2. Framework Preset: **Other**
3. **Environment Variables** に以下を設定（Production / Preview 両方推奨）:

| 変数名 | 値 |
|---|---|
| `DATABASE_URL` | Neon の接続文字列 |
| `GOOGLE_CLIENT_ID` | Google OAuth |
| `GOOGLE_CLIENT_SECRET` | Google OAuth |
| `GOOGLE_REDIRECT_URI` | `https://<project>.vercel.app/api/auth/callback` |
| `JWT_SECRET` | 32文字以上のランダム文字列 |
| `ADMIN_EMAILS` | 教員の Gmail（カンマ区切り） |
| `FRONTEND_URL` | `https://9liplantara-sketch.github.io/ta-rabo-works` |
| `AIO_USERNAME` | Adafruit IO ユーザー名（Where is TARA? 連携） |
| `AIO_KEY` | Adafruit IO Active Key（サーバーのみ。フロントに書かない） |
| `API_ALLOWED_ORIGINS` | `https://9liplantara-sketch.github.io` |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob の Read/Write トークン（日報画像。サーバーのみ） |

### 日報の直接画像アップロード（任意・確認後に本番適用）

1. Vercel ダッシュボードで **Storage → Blob** を作成（**private**）
2. 発行された `BLOB_READ_WRITE_TOKEN` を Environment Variables に設定
3. Neon SQL Editor で [`db/migrations/2026-11-daily-report-media.sql`](../db/migrations/2026-11-daily-report-media.sql) を実行
4. 再デプロイ後、テストアカウントで JPEG/PNG/WebP の投稿・閲覧・削除を確認

制限の目安: 1枚あたり最大 **3.5MB**（raw binary 送信。Vercel 関数ボディ上限 4.5MB 内）、日報あたり最大 12 枚、対応形式 JPEG / PNG / WebP（HEIC は非対応・案内表示）。サムネイルはサーバー生成。

期限切れの未使用画像掃除（API/CLI 共通: 原子的に `deleting` 確保 → Blob 削除。添付確定と競合したら Blob は触らない）:
- API: `POST /api/daily-reports?resource=media&action=purge&older_than_hours=24`（ログイン必須・本人分。教員は全体候補）
- CLI: `node scripts/purge-daily-report-media.mjs`（`DATABASE_URL` と `BLOB_READ_WRITE_TOKEN`。`--dry-run` 可。本番実行は確認後）
- スタックした `deleting` は約 15 分後に再確保可能（確保ごとに `delete_claim_token` を更新。古い処理の完了/失敗更新は token 不一致で無視）。
- Blob 失敗時は `delete_failed` で pathname を残し再試行。

4. **Deploy**
5. デプロイ URL を控える（例: `https://ta-rabo-works.vercel.app`）

### フロントの API URL

`lab_manager.html` はデフォルトで `https://ta-rabo-works.vercel.app` を参照します。
プロジェクト名が異なる場合は、HTML 先頭付近の `TA_RABO_API_BASE` を書き換えるか、ページ読み込み前に次を設定:

```html
<script>window.TA_RABO_API_BASE = 'https://あなたのプロジェクト.vercel.app';</script>
```

---

## 4. 動作確認

1. GitHub Pages で `lab_manager.html` を開く
2. サイドバー下部 **「Googleでログイン」**
3. 許可された Google アカウントでログイン
4. **日報** タブで投稿 → Neon の `daily_reports` に行が増えるか確認

### ログインできない場合

| 症状 | 確認 |
|---|---|
| `auth_error=not_allowed` | `students.email` または `ADMIN_EMAILS` にその Gmail があるか |
| `auth_error=unverified` | Google アカウントのメール確認 |
| CORS エラー | `API_ALLOWED_ORIGINS` に GitHub Pages のオリジンがあるか |
| 500 on daily-reports | `DATABASE_URL`・スキーマ・`drive_link` 列 |

---

## 5. ローカル API 開発（任意）

```bash
cp .env.example .env
# .env を編集
npm install
npx vercel dev
```

フロントは `python3 -m http.server 8765` で `lab_manager.html` を開き、
`TA_RABO_API_BASE` を `http://localhost:3000` に設定。

---

## 6. 次のフェーズ

- 学生進捗 API
- 素材ガイド API
- Google Drive リンク運用ルールの共有
- Google Sheets エクスポート（教員用・任意）

詳細設計: [neon-integration-plan.md](./neon-integration-plan.md)
