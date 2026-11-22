# 日報画像アップロード — Preview 検証準備メモ

本番 DB 変更・本番 Blob・Production デプロイは行わない。  
この文書は **push / クラウド作成の直前確認用**。

## 0. 手順の順序（重要）

**公式ドキュメント上**、Vercel は production 以外のブランチへの push で **Preview デプロイが自動作成**される（Git 連携済みプロジェクトの既定動作）。  
→ **検証ブランチへの push だけで自動デプロイが始まる想定**。

**このリポジトリの実アカウント設定（Git 連携の有無・Ignored Build Step・ブランチフィルタ）はダッシュボード未確認。**

そのため push より先に次を完了する:

1. Neon **schema-only** 検証ブランチ + seed（本番行をコピーしない）
2. Vercel **検証専用** private Blob（Production に接続しない）
3. Vercel Environment Variables を **Preview のみ** に分離投入  
   （`DATABASE_URL` / `BLOB_READ_WRITE_TOKEN` / `JWT_SECRET` / `GOOGLE_REDIRECT_URI` / `FRONTEND_URL` 等。Production を上書きしない）
4. Google Console に Preview callback URI を追加
5. ローカルで `ta-rabo-preview-config.js` に **完全一致** の Preview URL を記入（後述）
6. その後に `git push`（この時点で Preview デプロイが走る想定）

push 前に Preview 用 env が無いと、自動デプロイされた Preview が誤って共有・欠落設定で動き得る。  
**Production デプロイ・本番 env 変更は行わない。**

---

## 1. Git の切り分け（実施済み・ローカル）

| 場所 | 内容 |
|---|---|
| ブランチ `cursor/daily-report-media-preview`（`origin/main` 起点） | 日報画像機能 + Preview 接続固定 |
| `cursor/white-wing-gate` 上の stash | where-auth / ホーム研究会枠 / 当時の混在差分を保全 |

### Preview ブランチに含める差分

- `api/daily-reports.js`
- `lib/daily-reports.js` / `lib/daily-report-media.js` / `lib/db-tx.js` / `lib/cors.js`
- `lib/ta-rabo-api-config.js` / `lib/auth.js`（Preview bridge・next 許可）
- `assets/js/daily-report-media-client.js`
- `assets/js/ta-rabo-api-config.js` / `ta-rabo-auth.js` / `ta-rabo-preview-config*.js`
- `lab_manager.html`（写真 UI。**`?apiBase=` 廃止**）
- `lab_manager.preview.html` / `auth_bridge.preview.html`
- `db/migrations/2026-11-daily-report-media.sql`
- `db/seed-daily-report-media-preview.sql`（架空データ）
- `scripts/verify-daily-report-media*.mjs` / `verify-preview-api-config.mjs` / `purge-daily-report-media.mjs`
- `package.json` / `package-lock.json`（`@vercel/blob`, `sharp`）

### 含めない（stash 側）

- `where-auth.html`、auth の `where-auth` allowlist
- `lab_manager.html` のホーム「seminar window / 3件」変更
- member-analysis fixture placeholder

### stash 復元（無条件 `stash pop` 禁止）

保全用 stash（画像変更も含む混在）:

- `stash@{0}`: `wip: where-auth + home seminar + media (preserve before media-preview branch)`

**復元時は pop しない。** 保全用を残し、必要な WIP だけ戻す:

```bash
# 一覧確認
git stash list

# 中身の確認（落とさない）
git stash show -p stash@{0} --stat

# white-wing 側 WIP だけが欲しい場合の例:
git switch cursor/white-wing-gate
# 必要なパスだけ checkout（例）
git checkout stash@{0} -- where-auth.html
# 必要なら他パスも個別指定。lab_manager の画像差分は media-preview ブランチ側を正とする

# 保全 stash は残す（drop / pop しない）
# 使い終わって不要になったら明示的に: git stash drop stash@{0}
```

画像 UI は `cursor/daily-report-media-preview` を正本とし、stash の media 片を上書き適用しない。

---

## 2. Preview 接続（`?apiBase=` 廃止）

| 画面 | 挙動 |
|---|---|
| `lab_manager.html`（本番・通常） | クエリでの API 変更は不可。常に `https://ta-rabo-works.vercel.app`。`works.ta-rabo.com` 上では Preview 設定も無視 |
| `lab_manager.preview.html` | 検証入口。`ta-rabo-preview-config.js` の **完全一致 allowlist** 必須。欠落時はエラー表示（**本番 API へフォールバックしない**） |
| `auth_bridge.preview.html` | OAuth 復帰専用。設定欠落時は `auth_code` を転送しない |

### ローカル設定

```bash
cp assets/js/ta-rabo-preview-config.example.js assets/js/ta-rabo-preview-config.js
# ALLOWLIST / API_BASE を Preview デプロイ URL に書き換え（末尾スラッシュなし・完全一致）
```

任意 `*.vercel.app` ワイルドカードは不可。個人の検証 URL を MODE=preview のままコミットしない。

### OAuth 経路（接続維持）

1. `lab_manager.preview.html` → `sessionStorage.ta_rabo_page_profile=preview`
2. Google ログインは Preview API（`getApiBase()`）へ。`next=lab_manager.preview.html`
3. Callback → `auth_bridge.preview.html` → `lab_manager.preview.html?auth_code=…`
4. セッションキーは `ta_rabo_session_token__preview` 等（本番キーと分離）

### 自動テスト

```bash
npm run verify:preview-api-config
```

確認内容: 未許可ホスト拒否、欠落時の非フォールバック、Preview bridge、本番モード固定。

---

## 3. Preview が接続すべきサーバー設定（Production と分離）

Vercel の Environment は **Preview**（必要なら Development）だけにテスト値を置く。  
**Production の `DATABASE_URL` / Blob トークンを上書きしない。**

| 変数 | Preview での扱い | Production |
|---|---|---|
| `DATABASE_URL` | **テスト用** Neon（schema-only branch または別プロジェクト） | 現行本番のまま・触らない |
| `BLOB_READ_WRITE_TOKEN` | **検証専用** private Blob のトークンのみ | 未設定のまま（または本番用は後で別途）。検証ストアを Production に接続しない |
| `JWT_SECRET` | Preview 専用の新しい乱数推奨（本番セッションと混線させない） | 現行のまま |
| `GOOGLE_CLIENT_ID` / `SECRET` | 同じ OAuth クライアントで可 | 同じで可 |
| `GOOGLE_REDIRECT_URI` | **Preview ホスト**の `/api/auth/callback` を Google Console に追加し、Preview 環境変数だけ差し替え | 現行 Production URL のまま |
| `FRONTEND_URL` | `http://127.0.0.1:8765`（ローカル静的） | 現行 `works.ta-rabo.com` 等 |
| `API_ALLOWED_ORIGINS` | 既定に `localhost` / `works.ta-rabo.com` あり。追加が必要なら Preview のみ | 現行のまま |
| `ADMIN_EMAILS` | **検証用教員 Gmail のみ**（本番名簿をコピーしない） | 現行のまま |

### 誤接続を防ぐチェック

1. Vercel → Project → Settings → Environment Variables で、各変数の Environment 列が **Preview のみ**か確認  
2. Blob ストアの「Connected Projects」で **Production がチェックされていない**こと  
3. Preview デプロイの Runtime Logs / `GET /api/health` で、誤って本番 DB を指していないか（テスト seed の架空 email が見えるか）で確認  
4. `vercel env pull` した `.env.local` を Production に貼り付けない

### フロント操作手順（クラウド用意後）

1. ローカル: `python3 -m http.server 8765`
2. 開く: `http://127.0.0.1:8765/lab_manager.preview.html`（`?apiBase=` は使わない）
3. Google Console のリダイレクト URI に  
   `https://<exact-preview-host>.vercel.app/api/auth/callback` を追加
4. `return_origin=http://127.0.0.1:8765` は `sanitizeReturnOrigin` で許可済み
5. CORS: 画像用ヘッダあり。OPTIONS → POST raw binary を DevTools で確認

---

## 4. テスト DB（実データ非複製）

**推奨:** Neon **schema-only** branch  
または新規 Neon プロジェクトに `db/schema.sql` + 必要 migration を適用。

**非推奨:** 通常の data 付き branch（本番学生行がコピーされる）。

手順概要:

1. Neon Console → New branch → **Schema only** → 名前例 `preview-daily-report-media`
2. 足りない migration があれば SQL Editor で適用（特に `2026-11-daily-report-media.sql`）
3. `db/seed-daily-report-media-preview.sql` を実行（架空の教員1・学生2・日報2）
4. seed の `preview-*-@example.com` を、検証に使う **実 Gmail** に UPDATE（example.com では OAuth 不可）
5. Preview の `DATABASE_URL` をこのブランチの接続文字列に設定

検証後: ブランチ削除 or プロジェクト削除。

---

## 5. 検証チェックリスト（クラウド用意後）

- [ ] Preview API で JPEG 投稿（raw binary）・サムネ表示・ライトボックス
- [ ] テスト DB で添付確定 vs purge 競合、日報保存失敗時のロールバック
- [ ] 本人 / 別学生 / 教員 / 未ログインの画像 GET
- [ ] 公開範囲変更後のアクセス
- [ ] ログアウト・アカウント切替で Object URL キャッシュ破棄
- [ ] スマホで選択・投稿・失敗再試行
- [ ] 既存 URL 添付（seed の example.com）が残ること
- [ ] OAuth 復帰後も Preview API（Network でホスト確認）
- [ ] 検証設定欠落時に Production へリクエストが飛ばないこと

メモリ結合テストは **実 Neon TX の代替にしない**。

---

## 6. 費用（公式の一般枠 vs 実アカウント）

### 公式ドキュメント上の一般的な枠（目安）

契約プラン・時期で変わる。断定しない。

| サービス | 公式の目安 | 出典の見方 |
|---|---|---|
| Vercel Hobby | Preview は Git push ごとに作成される旨。Hobby にデプロイ枠・転送枠あり（例: Fast Data Transfer 等） | [Deployments / Environments](https://vercel.com/docs/deployments/environments), [Plans](https://vercel.com/docs/plans) |
| Vercel Blob (Hobby) | プランに含まれるストレージ・操作・転送の上限の記載あり。Server Uploads は転送メトリクス対象になり得る | Blob / Limits ドキュメント |
| Neon Free | schema-only branch・branch 数上限・CU-hours の枠 | Neon Billing / Branches ドキュメント |
| Google OAuth | リダイレクト URI 追加は通常追加料金なし | Cloud Console |

### 実アカウントの確認結果

| 項目 | 結果 |
|---|---|
| Vercel Usage / Blob usage | **未確認**（ダッシュボード未アクセス） |
| Vercel の本プロジェクト Git 連携・自動 Preview の実設定 | **未確認**（CLI は sandbox 制限で project ls 失敗。公式既定は「全ブランチ push で Preview」） |
| Neon Billing / branch 使用量 | **未確認** |
| 実課金・クォータ残量 | **未確認** |

確認場所: Vercel → Usage / Project → Settings → Git / Environment Variables。Neon Console → Billing / Branches。

片付け（検証後）: 検証 Blob 削除、Preview 用 env 削除、Neon 検証 branch 削除、Google の Preview URI 削除。

---

## 7. push / 作成の直前に確認する対象一覧

**これから承認が必要な操作（まだ実行しない）:**

1. Neon schema-only branch 作成 + seed  
2. Vercel **検証専用** Blob（private）作成（Production 非接続）  
3. Vercel Preview 用 env 投入（上記分離）  
4. Google Console に Preview callback URI 追加  
5. ローカル `ta-rabo-preview-config.js` にデプロイ後の完全一致 URL を記入  
6. `git push -u origin cursor/daily-report-media-preview`（自動 Preview 発火想定）

**やらない:** 本番 Neon への migration、Production Blob、Production デプロイ、実学生データの複製、無条件 `git stash pop`。
