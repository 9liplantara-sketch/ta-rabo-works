# ta_rabo — Works & Tools

田羅義史（ta_rabo）のポートフォリオ図解・研究室支援ツール集です。  
すべて **静的 HTML** で動作し、サーバー不要でブラウザだけで使えます。

🌐 **公開URL（ルート）**: https://9liplantara-sketch.github.io/ta-rabo-works/

### ローカルで短い `file://` URL（Mac）

フォルダ名に日本語が含まれると、ブラウザのアドレスバーが `%E8%87%AA...` のように長くなります。  
デスクトップに **`tarabo`** というシンボリックリンクを置いてある場合は、次のように短く開けます。

- ポータル: `file:///Users/ta_rabo/Desktop/tarabo/index.html`

リンクの実体は従来どおり `自己紹介とスキル` フォルダです（中身は同一）。リンクが無い場合はターミナルで次を実行してください。

```bash
ln -s "/Users/ta_rabo/Desktop/自己紹介とスキル" "/Users/ta_rabo/Desktop/tarabo"
```

### 主要ページへの直リンク（誰でも閲覧可）

| ページ | URL |
|---|---|
| ポータルトップ | https://9liplantara-sketch.github.io/ta-rabo-works/ |
| ポータルトップ（index.html） | https://9liplantara-sketch.github.io/ta-rabo-works/index.html |
| 研究室マネージャー（開発の中心） | https://9liplantara-sketch.github.io/ta-rabo-works/lab_manager.html |
| 自己紹介図解 | https://9liplantara-sketch.github.io/ta-rabo-works/ta_rabo_profile.html |
| 授業デザイン図解（試作・Teaching 用） | https://9liplantara-sketch.github.io/ta-rabo-works/lesson_design.html |
| 各ツール説明（独立ドキュメント・他ページへ非リンク） | https://9liplantara-sketch.github.io/ta-rabo-works/works_tools_description.html |

---

## コンテンツ一覧

| ファイル | 説明 |
|---|---|
| [`index.html`](index.html) | ポータルトップ（中心: 研究室マネージャー + 自己紹介図解） |
| [`lab_manager.html`](lab_manager.html) | 研究室マネージャー（**研究室方針**・素材ガイド・カレンダー・**研究会スケジュール**・学生進捗・日報） |
| [`ta_rabo_profile.html`](ta_rabo_profile.html) | 自己紹介インタラクティブ図解（作品詳細は [t-a-labo.com](https://www.t-a-labo.com)） |
| [`lesson_design.html`](lesson_design.html) | 授業・WS 設計用フレームワーク（試作。研究室運営とは役割を分離） |
| [`docs/neon-integration-plan.md`](docs/neon-integration-plan.md) | Neon Postgres 連携設計書 |
| [`db/schema.sql`](db/schema.sql) | PostgreSQL スキーマ（Neon SQL Editor で実行） |
| [`db/migrations/`](db/migrations/) | 既存 DB 向けの差分マイグレーション |
| [`api/daily-reports.js`](api/daily-reports.js) | 日報 API（Neon 正本・GET view 切替 / POST） |
| [`api/students.js`](api/students.js) | 学生 API（GET / POST / PATCH） |
| [`data/seminar-schedule.js`](data/seminar-schedule.js) | 研究会スケジュールデータ（現行 SSoT） |
| [`data/seminar-schedule.ics`](data/seminar-schedule.ics) | ICS 公開用（`node scripts/generate-seminar-ics.mjs` で再生成） |
| [`works_tools_description.html`](works_tools_description.html) | 各ツールの説明のみ（独立ページ・他 HTML へリンクなし） |

---

## 研究室マネージャーの機能

- **研究室方針** — 図解・カード・抽象アイコン中心のビジュアルページ。方向性・制作ペース・卒論/卒制・必須インプット・学生に求めること・制作プロセスを一覧
- **素材ガイド** — 陶芸・漆・金属・木材・屋内・隣族など各素材の技法と手順を図説で管理
- **カレンダー** — 教員＋在籍学生の空き日を色別入力し、全員が空いた日を自動で研究会候補日に設定（学生数は `students` テーブルから動的取得）。長期タスクのドラッグ入力にも対応
- **研究会スケジュール** — 毎週金曜日 13:00〜15:00（初回 2026/7/17）のレクチャー／発表サイクル、タイムテーブル、2026–2027年の年間予定（次回予定・種類ラベル付き）。**ICS ダウンロード・URL 購読**で Google／Apple カレンダーに連携可能
- **学生進捗** — マイルストーンのチェックリスト＋研究ノート（テキスト・画像）。表示名は Neon `students` と同期
- **メンバー管理** — 教員（admin）が学生の追加・編集・active 切替（Neon `students` テーブル）
- **日報** — Google ログインで **Neon Postgres（正本DB）** に保存。日付・今日やったこと・うまくいったこと・詰まっていること・次にやること・関連テーマ・所要時間・作業場所・Drive リンク・**共有範囲**を記録
- **ホーム** — 各セクションのダイジェストと期日が近いタスクのアラートを一覧表示

> 素材ガイド・学生進捗（マイルストーン/ノート）の詳細データは現状 **localStorage** に保存されます。  
> **学生情報（氏名・メール・表示名）と日報は Neon Postgres を正本DB**として運用します（未ログイン時の日報のみ localStorage に一時保存）。  
> 研究会スケジュールは静的ファイル（[`data/seminar-schedule.js`](data/seminar-schedule.js)）で配信しています。

### 学生管理（Neon `students` テーブル）

- 学生数は **2人固定ではなく可変**。教員が追加・編集できる
- **教員（admin）** — 学生の追加、氏名・表示名・メール・active の編集
- **学生本人** — 自分の **氏名** と **表示名（display_name）** を編集（`PATCH /api/students`）
- 日報投稿時の `student_name` は **display_name → name** の順で自動反映（過去日報は書き換えない）
- 外部サービス（Typeless 等）への同期は行わない。正本は Neon のみ

### 学生 API（[`api/students.js`](api/students.js)）

| メソッド | 権限 | 内容 |
|---|---|---|
| `GET` | ログイン必須（未ログインは 401） | admin: 全件 / student: アクティブメンバー一覧＋自分情報 |
| `POST` | admin のみ | 学生追加（name/email/role・email 重複時は再活性化・名前更新） |
| `PATCH` | admin: 任意 / student: 自分のみ | admin は氏名・表示名・メール・role・active、student は氏名・表示名のみ |

- `GET /api/auth/me` は `id / name / display_name / email / role / is_active` を返す（Neon `students` を参照して補完）

#### 既存 Neon DB へのマイグレーション（初回のみ）

学生 API を有効化するには、既存の Neon DB に表示用・在籍管理カラムを追加します。  
[`db/migrations/2026-07-students-display-fields.sql`](db/migrations/2026-07-students-display-fields.sql) を **Neon SQL Editor にそのまま貼り付けて一度だけ実行**してください（`ADD COLUMN IF NOT EXISTS` で冪等・再実行安全）。追加するのは `display_name` / `note` / `icon_color` / `enrolled_at` / `is_active` / `created_at` / `updated_at` と `updated_at` 自動更新トリガーです。新規構築時は `db/schema.sql` に統合済みのため実行不要です。

### 日報の共有範囲（visibility）

日報には個人情報や悩みが含まれる可能性があるため、投稿ごとに公開範囲を設定します。**初期値は `private`** です。

| 値 | 意味 |
|---|---|
| `private` | 本人と教員のみが閲覧可能（初期値） |
| `lab` | 研究室メンバー全員に共有 |
| `public` | 将来的に公開可能 |

### 日報のビュー

- **自分の日報（`view=mine`）** — ログイン中の本人が投稿した日報の一覧。共有範囲を問わず全件表示
- **研究室共有ビュー（`view=lab`）** — `visibility` が `lab` / `public` の日報のみをカード表示。`private` は表示しない。学生同士が状況をゆるく共有し、声をかけ合うためのビュー
- **教員ビュー（`view=all`）** — ログインユーザーが **admin のときのみ**表示。全学生の日報を確認でき、共有範囲・最終更新も一覧できる

### 日報 API のルール（[`api/daily-reports.js`](api/daily-reports.js)）

- 未ログインは **401**
- `GET ?view=mine`：本人の日報のみ
- `GET ?view=lab`：`visibility IN ('lab','public')` のみ（student は他人の private を見られない）
- `GET ?view=all`：**admin のみ**（それ以外は 403）
- `POST`：student は自分のメールで投稿。`visibility` 未指定は `private`。日付・今日やったことが空なら保存しない

---

## アーキテクチャと今後の方針（Neon Postgres）

| 層 | 役割 | 現状 |
|---|---|---|
| **GitHub Pages** | 静的 HTML / JS / ICS の配信 | 運用中 |
| **API**（Vercel Serverless Functions） | 書き込み・非公開データ取得、Neon 接続、Google ログイン | **日報・学生 API 運用中** |
| **Neon Postgres** | 学生情報・日報の永続化（正本DB）／進捗詳細は今後 | **students・daily_reports 接続済み** |

- 静的表示は **GitHub Pages + 静的データ**で運用しています。
- **学生情報と日報は Neon Postgres を正本DB**として運用します。
- **素材ガイド・学生進捗（マイルストーン/ノート）**は引き続き localStorage（今後 Neon 化を検討）。
- Neon へ安全に接続するには **サーバー側 API 層**が必要です。**GitHub Pages だけでは `DATABASE_URL` を安全に扱えません**（フロントに直書きしないこと）。
- 将来的には **Vercel / Netlify / Cloudflare Pages Functions** 等で API をホストし、GitHub Pages はフロントのまま維持する構成を想定しています。

詳細設計: [`docs/neon-integration-plan.md`](docs/neon-integration-plan.md)  
**セットアップ手順（Neon + Vercel + Google ログイン）:** [`docs/vercel-neon-google-setup.md`](docs/vercel-neon-google-setup.md)  
DB スキーマ案: [`db/schema.sql`](db/schema.sql)  

Neon SQL Editor への貼り付け（macOS）:

```bash
cd ta-rabo-works
pbcopy < db/schema.sql
```

`db/schema.sql` のファイル全文をコピーし、Neon SQL Editor に貼り付けて実行してください。Markdown のコードブロックや README 内のパス行はコピーしないでください。
環境変数テンプレート: [`.env.example`](.env.example)（`DATABASE_URL` は API ホストの環境変数のみ）

### 日報のクラウド保存（Phase 1）

- Googleログイン後、日報は **Vercel API → Neon** に保存されます
- 未ログイン時は従来どおり **localStorage**（その端末のみ）
- API 実装: `api/daily-reports.js`、`api/auth/*`
- Vercel デプロイ後、`lab_manager.html` の `TA_RABO_API_BASE` をプロジェクト URL に合わせる

---

## Cursor スキル（AI エージェント向け）

このリポジトリには Cursor IDE 用の **Agent Skill** が含まれています。  
プロフィール図解の再生成・更新に必要な設計仕様を SSoT（Single Source of Truth）として管理しています。

### スキルの場所

```
.cursor/skills/profile-diagram/
├── SKILL.md                    ← スキル定義（エントリポイント）
└── references/
    ├── design-tokens.md        ← フォント・カラーパレット
    ├── activity-map.md         ← Activity Map のノードデータ・実装仕様
    └── html-snippets.md        ← セクション別 HTML テンプレート
```

### スキルのインストール方法

```bash
# プロジェクト固有のスキルとして使う場合はそのまま clone するだけで有効
git clone https://github.com/ta-rabo/works.git

# 全プロジェクトで使えるグローバルスキルにする場合
cp -r .cursor/skills/profile-diagram ~/.cursor/skills/
```

Cursor の設定で「Skills」タブに `profile-diagram` が表示されれば有効です。

---

## ローカルで開く

```bash
git clone https://github.com/9liplantara-sketch/ta-rabo-works.git
cd ta-rabo-works
open index.html   # macOS
# または任意のブラウザで index.html をダブルクリック
open lab_manager.html   # 研究室マネージャー（サイドバー「研究会」でスケジュール確認）
```

研究室マネージャー内の **研究会スケジュール** は `lab_manager.html` を開き、左サイドバーの「研究会」をクリックしてください。データは [`data/seminar-schedule.js`](data/seminar-schedule.js) に分離されています。

### 研究会スケジュールのカレンダー連携（ICS）

| ファイル | 説明 |
|---|---|
| [`data/seminar-schedule.js`](data/seminar-schedule.js) | 予定データの唯一のソース（編集はここ） |
| [`data/seminar-schedule.ics`](data/seminar-schedule.ics) | 公開用 iCalendar ファイル（静的生成） |

**公開 URL（購読・インポート用）**

- HTTPS: https://9liplantara-sketch.github.io/ta-rabo-works/data/seminar-schedule.ics
- webcal: `webcal://9liplantara-sketch.github.io/ta-rabo-works/data/seminar-schedule.ics`

**Googleカレンダーへの追加**

1. **URLで購読（推奨）** — Googleカレンダー → 左「他のカレンダー」→「＋」→「URLから追加」→ 上記 HTTPS URL を貼り付け
2. **ファイルでインポート** — 研究会ページの「ICSをダウンロード」、または上記 URL を保存 → Googleカレンダー → 設定 →「インポートとエクスポート」→ ファイルを選択

**スケジュールを更新するとき**

1. `data/seminar-schedule.js` を編集する
2. 静的 ICS を再生成する:

```bash
node scripts/generate-seminar-ics.mjs
```

3. 変更を GitHub に push する（Pages 上の `.ics` URL も更新される）

研究会ページからもブラウザ上で ICS をダウンロードできます（`generateSeminarIcs()` で Blob 生成）。URL 購読を使っている学生には、push 後にカレンダー側で自動反映される場合があります（反映タイミングは Google 側の仕様に依存）。

---

## 技術仕様

- **フレームワーク**: Vanilla HTML / CSS / JavaScript（依存ライブラリなし）
- **アイコン**: [Iconify](https://iconify.design/) + Phosphor Icons（CDN）
- **フォント**: Google Fonts（Noto Sans JP / Space Mono）
- **データ永続化**: localStorage（日報・進捗・素材・カレンダー）/ 静的 JS（研究会スケジュール）
- **将来**: Neon Postgres + Serverless API（設計: `docs/neon-integration-plan.md`）

---

© 2025 田羅義史 (ta_rabo) — [t-a-labo.com](https://www.t-a-labo.com)
