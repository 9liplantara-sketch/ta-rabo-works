# Neon Postgres 連携設計書 — ta_rabo 研究室マネージャー

最終更新: 2026-06-28  
対象リポジトリ: `ta-rabo-works` / `lab_manager.html`

---

## 1. 目的

研究室マネージャーを、学生が実際に使える**運用ツール**にする。

現状は静的 HTML + ブラウザ `localStorage` で動作しており、端末をまたいだ共有や教員による一元管理ができない。  
**Neon（Serverless Postgres）** をデータベースとして採用し、以下を安全に管理できるようにする。

| 機能 | 現状 | 将来 |
|---|---|---|
| 研究会スケジュール | 静的 `data/seminar-schedule.js` + ICS | DB 管理 + 静的 ICS 生成 or API |
| Googleカレンダー連携 | ICS ダウンロード / URL 購読 | 継続（ICS は公開用エクスポートとして維持） |
| 日報 | localStorage | Neon + API |
| 素材ガイド | localStorage（初期データ同梱） | Neon + API |
| 学生進捗 | localStorage | Neon + API |
| カレンダー（空き日・タスク） | localStorage | 要検討（第2フェーズ） |

---

## 2. 想定構成

```text
GitHub Pages
└─ 静的配信（フロントエンド）
   ├─ lab_manager.html
   ├─ 研究会スケジュール（閲覧）
   ├─ ICS 連携（seminar-schedule.ics）
   └─ 素材ガイド閲覧（GET API 経由 or 静的キャッシュ）

Vercel / Netlify / Cloudflare Pages Functions
└─ API 層（サーバー側のみ Neon 接続）
   ├─ GET  /api/seminar-events
   ├─ POST /api/daily-reports
   ├─ GET  /api/material-guides
   ├─ GET  /api/student-progress
   ├─ POST /api/student-progress
   └─ （将来）認証・管理者 API

Neon Postgres
└─ PostgreSQL
   ├─ students          （推奨: 正規化）
   ├─ projects          （推奨: 研究テーマ単位）
   ├─ seminar_events
   ├─ daily_reports
   ├─ material_guides
   └─ student_progress
```

### データフロー（書き込み）

```text
学生ブラウザ → lab_manager.html → fetch(API_BASE_URL/...)
                                      ↓
                              Serverless Function
                                      ↓
                              DATABASE_URL（環境変数）
                                      ↓
                              Neon Postgres
```

**フロントエンドは `DATABASE_URL` を一切知らない。**

---

## 3. なぜ GitHub Pages だけでは足りないか

| 要件 | GitHub Pages | API + Neon |
|---|---|---|
| 静的 HTML/CSS/JS 配信 | ○ | ○（別ホストでも可） |
| サーバー側で DB 接続 | × | ○ |
| 環境変数で秘密情報管理 | × | ○ |
| 学生の日報 POST | × | ○ |
| 認証付き書き込み | × | ○ |
| CORS 制御 | 不要 | API 側で設定 |

GitHub Pages は**静的サイト配信**に最適だが、Neon へ安全に接続するためのサーバー側処理を持てない。  
接続文字列をフロントに埋め込むと誰でも DB を操作できてしまうため、**書き込み・非公開取得には API 層が必須**。

---

## 4. 公開環境の現状（2026-06-28 確認）

| URL | 状態 | 備考 |
|---|---|---|
| `https://9liplantara-sketch.github.io/ta-rabo-works/` | 200 | `index.html` から `lab_manager.html` へリンクあり |
| `.../lab_manager.html` | 200 | 本番で開ける |
| `.../data/seminar-schedule.js` | **404** | ローカルに存在するが **git 未追跡・未 push** |
| `.../data/seminar-schedule.ics` | **404** | 同上 |

### 対応事項（公開を完成させる）

1. `data/` と `scripts/` を git に追加して push
2. `.nojekyll` をリポジトリルートに置く（Jekyll 無効化・将来の `_` 始まりパス対策）
3. `lab_manager.html` の script は `./data/seminar-schedule.js`（相対パス）— 問題なし
4. push 後に本番 URL で研究会ページ・ICS を再確認

---

## 5. DB スキーマ概要

詳細 DDL: [`db/schema.sql`](../db/schema.sql)

### コアテーブル

| テーブル | 用途 |
|---|---|
| `seminar_events` | 研究会・公式日程 |
| `daily_reports` | 学生日報 |
| `material_guides` | 素材ガイド |
| `student_progress` | 進捗スナップショット |

### 推奨追加テーブル

| テーブル | 理由 |
|---|---|
| `students` | `student_email` の重複排除、認証連携の基点 |
| `projects` | 研究テーマ・卒論単位で日報・進捗を紐づけ |

---

## 6. API 構成案

ベース URL 例: `https://ta-rabo-lab-api.vercel.app`（仮）

環境変数（API ホスト側のみ）:

```env
DATABASE_URL=postgresql://...@...neon.tech/neondb?sslmode=require
API_ALLOWED_ORIGINS=https://9liplantara-sketch.github.io
```

フロント側（公開可）:

```env
VITE_API_BASE_URL=https://ta-rabo-lab-api.vercel.app
# または lab_manager.html 内の定数（秘密情報ではない）
```

---

### GET /api/seminar-events

| 項目 | 内容 |
|---|---|
| 目的 | 研究会スケジュール一覧を取得 |
| 入力 | `?from=2026-07-01&to=2027-03-01`（任意）、`?include_cancelled=false` |
| 出力 | `{ events: [{ id, date, start_time, end_time, type, title, description, is_official, is_cancelled }] }` |
| 公開範囲 | **公開**（認証不要で閲覧可） |
| 認証 | 不要（読み取り専用・公開情報） |
| テーブル | `seminar_events` |

---

### POST /api/daily-reports

| 項目 | 内容 |
|---|---|
| 目的 | 学生が日報を投稿 |
| 入力 | `{ report_date, student_email, did_today, stuck_points, next_action, related_project?, visibility }` |
| 出力 | `{ id, created_at }` |
| 公開範囲 | `visibility`: `lab`（教員+学生）/ `private`（本人+教員） |
| 認証 | **必要**（学生または教員セッション） |
| テーブル | `daily_reports`, `students` |

バリデーション: 必須項目、日付形式、文字数上限、`student_email` が登録済みか。

---

### GET /api/material-guides

| 項目 | 内容 |
|---|---|
| 目的 | 素材ガイド一覧・詳細取得 |
| 入力 | `?category=陶芸`（任意） |
| 出力 | `{ guides: [{ id, material_name, category, use_case, how_to_use, cautions, reference_url, image_url }] }` |
| 公開範囲 | **公開**（閲覧は研究室メンバー向けだが認証前は公開読み取りも可—要方針決定） |
| 認証 | 読み取りは不要でも可 / 編集は教員のみ |
| テーブル | `material_guides` |

---

### GET /api/student-progress

| 項目 | 内容 |
|---|---|
| 目的 | 学生進捗一覧取得 |
| 入力 | `?student_email=`（任意、教員は全員、学生は自分のみ） |
| 出力 | `{ progress: [{ id, student_name, research_theme, monthly_output, next_task, status, last_reviewed_at }] }` |
| 公開範囲 | 教員: 全員 / 学生: 自分のみ |
| 認証 | **必要** |
| テーブル | `student_progress`, `students` |

---

### POST /api/student-progress

| 項目 | 内容 |
|---|---|
| 目的 | 進捗の新規登録・更新 |
| 入力 | `{ student_email, research_theme?, monthly_output?, next_task?, status? }` |
| 出力 | `{ id, updated_at }` |
| 公開範囲 | 学生は自分、教員は全員 |
| 認証 | **必要** |
| テーブル | `student_progress` |

---

## 7. セキュリティ方針

1. **`DATABASE_URL` をフロントエンドに直書きしない** — API の環境変数のみ
2. **`.env` を git にコミットしない** — `.env.example` のみリポジトリに含める
3. **日報・進捗は個人情報を含む** — `visibility` とロールで公開範囲を制御
4. **API には認証を導入する** — 第1段階は簡易トークン、将来は Clerk / Auth.js / Neon RLS 等
5. **書き込み API にバリデーション** — zod 等で入力検証、SQL はパラメータ化
6. **管理者と学生の権限分離** — `role: admin | student` を `students` テーブルで管理
7. **公開情報と非公開情報の分離** — 研究会スケジュールは公開、日報は非公開がデフォルト
8. **CORS** — GitHub Pages のオリジンのみ許可
9. **レート制限** — POST 系に導入を検討

---

## 8. 移行フェーズ（推奨優先順位）

### Phase 0 — 公開整備（今すぐ）

- [ ] `data/` を git push して GitHub Pages で研究会・ICS を有効化
- [ ] `.nojekyll` 追加
- [ ] 本番 URL 動作確認

### Phase 1 — DB 基盤

- [ ] Neon プロジェクト作成（手動・別作業）
- [ ] `db/schema.sql` を Neon SQL Editor で実行
- [ ] `seminar_events` に `seminar-schedule.js` からデータ投入スクリプト

### Phase 2 — 読み取り API

- [ ] Vercel Functions（または Cloudflare Workers）で GET API
- [ ] `GET /api/seminar-events` → フロントはフォールバックで静的 JS も維持
- [ ] `GET /api/material-guides` → 素材ガイドの初期データ移行

### Phase 3 — 書き込み API + 認証

- [ ] 認証（Magic Link / パスワードレス等）
- [ ] `POST /api/daily-reports`
- [ ] `POST /api/student-progress`
- [ ] lab_manager.html から fetch 連携（localStorage はオフラインキャッシュとして残すか廃止）

### Phase 4 — 運用

- [ ] ICS を API or ビルド時に `seminar_events` から再生成
- [ ] カレンダー空き日の DB 化（任意）
- [ ] 管理画面（教員用）

---

## 9. 技術選定メモ

| 候補 | メリット | デメリット |
|---|---|---|
| **Vercel Functions** | Node.js、Neon 公式連携、手軽 | 無料枠・コールドスタート |
| **Cloudflare Workers** | 高速、Pages と同居可 | Neon 接続は Hyperdrive 等が必要 |
| **Netlify Functions** | GitHub 連携が簡単 | 同様にコールドスタート |

初回実装は **Vercel + `@neondatabase/serverless`** を推奨（ドキュメント豊富）。

---

## 10. 関連ファイル

| パス | 説明 |
|---|---|
| `db/schema.sql` | PostgreSQL DDL |
| `.env.example` | 環境変数テンプレート（値は空） |
| `data/seminar-schedule.js` | 現行スケジュール SSoT（移行元） |
| `scripts/generate-seminar-ics.mjs` | ICS 静的生成 |
| `lab_manager.html` | フロントエンド本体 |
