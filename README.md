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
| 自己紹介図解 | https://9liplantara-sketch.github.io/ta-rabo-works/ta_rabo_profile.html |
| 研究室マネージャー | https://9liplantara-sketch.github.io/ta-rabo-works/lab_manager.html |
| 授業デザイン図解 | https://9liplantara-sketch.github.io/ta-rabo-works/lesson_design.html |
| 各ツール説明（独立ドキュメント・他ページへ非リンク） | https://9liplantara-sketch.github.io/ta-rabo-works/works_tools_description.html |
| スキル図解（シルエット＋アイコン） | https://9liplantara-sketch.github.io/ta-rabo-works/skills_diagram.html |

---

## コンテンツ一覧

| ファイル | 説明 |
|---|---|
| [`index.html`](index.html) | ポータルトップ |
| [`ta_rabo_profile.html`](ta_rabo_profile.html) | 自己紹介インタラクティブ図解 |
| [`lab_manager.html`](lab_manager.html) | 研究室マネージャー（素材ガイド・カレンダー・**研究会スケジュール**・学生進捗・日報） |
| [`docs/neon-integration-plan.md`](docs/neon-integration-plan.md) | Neon Postgres 連携設計書 |
| [`db/schema.sql`](db/schema.sql) | PostgreSQL スキーマ案（未実行） |
| [`data/seminar-schedule.js`](data/seminar-schedule.js) | 研究会スケジュールデータ（現行 SSoT） |
| [`data/seminar-schedule.ics`](data/seminar-schedule.ics) | ICS 公開用（`node scripts/generate-seminar-ics.mjs` で再生成） |
| [`lesson_design.html`](lesson_design.html) | 授業デザインフレームワーク |
| [`works_tools_description.html`](works_tools_description.html) | 各ツールの説明のみ（独立ページ・他 HTML へリンクなし） |
| [`skills_diagram.html`](skills_diagram.html) | スキル・ツールの図解（シルエット SVG ＋ Iconify） |

---

## 研究室マネージャーの機能

- **素材ガイド** — 陶芸・漆・金属・木材・屋内・隣族など各素材の技法と手順を図説で管理
- **カレンダー** — 3人（教員＋学生2名）の空き日を色別入力し、全員が空いた日を自動で研究会候補日に設定。長期タスクのドラッグ入力にも対応
- **研究会スケジュール** — 毎週水曜3限（13:00〜15:00）のレクチャー／発表サイクル、タイムテーブル、2026–2027年の年間予定（次回予定・種類ラベル付き）。**ICS ダウンロード・URL 購読**で Google／Apple カレンダーに連携可能
- **学生進捗** — マイルストーンのチェックリスト＋研究ノート（テキスト・画像）
- **日報** — 日次の活動記録と次回課題の管理
- **ホーム** — 各セクションのダイジェストと期日が近いタスクのアラートを一覧表示

> 日報・素材ガイド・学生進捗・カレンダーのデータは現状 **localStorage** に保存されます。ブラウザをまたいで共有はできません。  
> 研究会スケジュールは静的ファイル（[`data/seminar-schedule.js`](data/seminar-schedule.js)）で配信しています。

---

## アーキテクチャと今後の方針（Neon Postgres）

| 層 | 役割 | 現状 |
|---|---|---|
| **GitHub Pages** | 静的 HTML / JS / ICS の配信 | 運用中 |
| **API**（Vercel / Netlify / Cloudflare Functions） | 書き込み・非公開データ取得、Neon 接続 | **未実装（設計済み）** |
| **Neon Postgres** | 日報・進捗・素材ガイド・スケジュールの永続化 | **未接続** |

- 現在は **静的 HTML + JavaScript** で動作し、研究会スケジュールと ICS 連携は **静的データ**（`data/seminar-schedule.js`）で運用しています。
- 今後、**日報・素材ガイド・学生進捗**は **Neon Postgres** 連携を検討しています。
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
