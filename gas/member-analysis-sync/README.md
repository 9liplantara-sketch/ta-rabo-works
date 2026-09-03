# メンバー分析 — Google Form 回答シート同期 GAS

価値観分析フォームの **回答スプレッドシート専用** です。  
`gas/seminar-reminder/`（研究会日程・LINE）とは **完全に別** の Apps Script プロジェクトとしてデプロイしてください。

## 対象

- Google Form から自動生成される回答スプレッドシート（v3 Form 用）
- デフォルトシート名: `フォームの回答 1`（先頭シートにフォールバック）

## Script Properties（必須）

GAS エディタ → プロジェクトの設定 → スクリプト プロパティ

| キー | 値の例 | 説明 |
|------|--------|------|
| `MEMBER_ANALYSIS_SYNC_ENDPOINT` | `https://ta-rabo-works.vercel.app/api/psych-assessments/sync` | Vercel sync API |
| `MEMBER_ANALYSIS_SYNC_SECRET` | （Vercel `MEMBER_ANALYSIS_SYNC_SECRET` と同一のランダム文字列） | 同期認証 |
| `MEMBER_ANALYSIS_FORM_ID` | （v3 Google Form の ID） | **Phase 1+** 質問IDマッピング用 |
| `MEMBER_ANALYSIS_ACADEMIC_YEAR` | `2026`（現行 Form） / `2027`（翌年度 Form） | **Phase 5A+** 収集年度の正本（Form title や現在日時から推定しない） |
| `MEMBER_ANALYSIS_COLLECTION_STATE` | `preparing` / `open` / `closed` | **Phase 5B+** 募集 lifecycle（業務状態。sync payload / DB には含めない） |
| `MEMBER_ANALYSIS_SYNC_ENABLED` | `false`（v3 推奨） / `true`（Phase 2 以降） | **技術的 sync 安全装置**（`COLLECTION_STATE` とは別） |

**v3 Spreadsheet では Phase 2 完了まで `今すぐ同期` を実行しないでください。**  
`MEMBER_ANALYSIS_FORM_ID` が設定されている Spreadsheet では、同期は自動的にブロックされます（定期 trigger 含む）。  
Phase 2 完了後に `MEMBER_ANALYSIS_SYNC_ENABLED=true` を設定して同期を有効化します。

**Secret の実値を README や Git に書かないでください。**

## ファイル構成

| ファイル | 役割 |
|----------|------|
| `Code.gs` | 回答 Sheet → Vercel 差分同期（v1: raw_answers / v3: raw_answers+item_answers） |
| `QuestionMapping.gs` | Form Item ID → 恒久 item_id マッピング（Phase 1） |
| `QuestionMappingMetadata.gs` | 監査済み metadata 定数（item_id 反映用・生成物） |

## Phase 2 メモ

- v3 は Mapping Sheet（active 118 / UNMAPPED=0）から `item_answers` を生成
- **hash は従来どおり raw_answers のみ**（item_answers を含めない）
- v3 の採点は Phase 3（`scoring_version=member-analysis-score-v3-deferred`）
- **`MEMBER_ANALYSIS_SYNC_ENABLED` は当面 `false` のまま**（remote 実送信しない）

### v3 Sync Hash 監査（Phase 4 dry-run）

**メンバー分析 → v3 Sync Hash 監査（開発）**（`previewMemberAnalysisV3SyncHashMigration`）で、既存行の hash 形式分類と `would_sync` 件数を確認できます。

- **read-only**（Form / Sheet / API / DB 変更なし）
- legacy `member_analysis_sync_hash` と stable `itemid-v1:` の dual-read 互換を検証
- row 番号・status・hash 形式のみ（回答本文・hash 全文は出力しない）

Phase 4 導入直後、内容変更がなければ `would sync rows: 0` が期待値です。

### v3 Sync Payload プレビュー（dry-run）

実環境 POST 前に、**メンバー分析 → v3 Sync Payload プレビュー**（`previewMemberAnalysisV3SyncPayload`）で確認できます。

- 実回答 Sheet の**最新タイムスタンプ行** 1 件を読み取り
- 本番と同じ `buildResponseMap_` / `buildSyncPayload_` で payload を構築
- **UrlFetchApp / Sheet 書込 / sync 状態変更 / scoring は行わない**（完全 read-only）
- Logger / ダイアログには統計のみ（回答本文・PII は出力しない）

期待値の例:

```
questionnaire_version = member-analysis-2026-v3
mapping active count = 118
mapping item_id count = 118
unresolved mapping count = 0
duplicate item_id count = 0
validation = PASS
```

## メニュー

```
メンバー分析
├ 今すぐ同期
├ 同期状態を確認
├ ─────────────
├ 質問IDマッピングを更新
├ 質問IDマッピングを確認
├ ─────────────
├ Form ItemType 診断（開発）
├ 尺度 Grid 診断（開発）
├ v3 Form scale columns 診断（開発・read-only）
├ ─────────────
├ Mapping metadata プレビュー / 反映（開発）
└ v3 Sync Payload プレビュー（開発・dry-run）
```

### v3 Form scale columns 診断（Phase 3 normalization 用）

**メンバー分析 → v3 Form scale columns 診断**（`debugMemberAnalysisV3FormScaleColumns`）で、4 尺度 Grid の `getColumns()` を Logger に JSON 出力します。

- **read-only**（Form / Sheet / API / Script Properties / DB 変更なし）
- 対象 google item id: Big Five=`322128877`, Values=`1956668441`, RF=`18110264`, RIASEC=`1118596123`
- 回答本文・氏名・メールはログしない

手順:

1. GAS を Spreadsheet に反映（`QuestionMapping.gs` + `Code.gs`）
2. メニューから診断を実行 → Logger の `grids` 配列をコピー
3. `test/fixtures/member-analysis-v3-form-scale-columns-actual.json` に保存
4. `npm run audit:member-analysis-v3-form-scale-columns` で canonical map と exact 比較

## Phase 1 — 質問IDマッピング

### 目的

v3 Google Form の Item ID を、Spreadsheet 上の `質問IDマッピング` Sheet で管理します。  
**恒久 item_id は人間が Sheet 上で確定**します。質問文からの自動推測は行いません。

### form_version

`member-analysis-2026-v3`（既存 v1 `member-analysis-2026-v1` とは別）

### Mapping Sheet 列

| 列 | 説明 |
|----|------|
| `form_version` | 例: `member-analysis-2026-v3` |
| `google_item_id` | Google Form Item ID |
| `row_index` | Grid 行 index（通常質問は空） |
| `row_label` | Grid 行ラベル |
| `item_id` | 恒久 ID（新規は `UNMAPPED`、人手で確定） |
| `question_version` | 例: `2026_v1`（人手入力） |
| `response_type` | Form 型から自動（text / scale / grid 等） |
| `scope` | 人手入力（将来 Repository 正本） |
| `instrument` | 人手入力 |
| `dimension` | 人手入力 |
| `reverse_scored` | 人手入力 |
| `source_header` | Form 質問タイトル（参照用） |
| `active` | `TRUE` / `FALSE` |

### 更新ルール

- **既存 `item_id`（UNMAPPED 以外）は上書きしない**
- Form から削除された Item は Sheet から自動削除しない（Phase 1 では Form 側を正として全置換）
- 新規 Item は `item_id = UNMAPPED`
- `google_item_id + row_index` が一意キー

### Validation

- UNMAPPED 件数（警告）
- `google_item_id + row_index` 重複（エラー）
- 確定済み `item_id` 重複（エラー）
- 同一 `item_id` で `source_header` 不一致（警告）

### Phase 1 で変更しないもの

- 同期 payload / `raw_answers` / hash（v3 Spreadsheet では **同期自体をブロック**）
- Vercel API / Neon DB / scoring
- `QUESTIONNAIRE_VERSION`（同期コード内は引き続き v1 — v3 切替は Phase 2 以降）

### v3 Spreadsheet — 同期禁止（Phase 2 まで）

以下のいずれかに該当する場合、`syncMemberAnalysisResponses` / **今すぐ同期** は実行されません:

- `MEMBER_ANALYSIS_SYNC_ENABLED=false`
- `MEMBER_ANALYSIS_FORM_ID` が設定されている（v3 Mapping 用）
- `質問IDマッピング` Sheet に `form_version=member-analysis-2026-v3` が存在

**定期 trigger** が v3 Spreadsheet に設定されている場合は、GAS エディタ → トリガー から **Phase 2 まで無効化**してください。  
（コード側でもブロックされますが、無駄な実行を避けるため手動無効化を推奨）

## 手動テスト（Phase 1 — Mapping のみ）

**v3 回答の sync E2E は Phase 2 以降。Phase 1 では「今すぐ同期」を実行しない。**

1. v3 Form の回答 Spreadsheet を開く
2. Script Property に `MEMBER_ANALYSIS_FORM_ID` を設定（`MEMBER_ANALYSIS_SYNC_ENABLED` は `false` または未設定）
3. GAS をデプロイ / 再読み込み
4. **メンバー分析 → 質問IDマッピングを更新**
5. `質問IDマッピング` Sheet が作成され、全 Form Item が列挙されること
6. Grid 設問は row ごとに行が分かれていること
7. 新規行の `item_id` が `UNMAPPED` であること
8. 恒久 ID マスターに従い `item_id` 等を手動入力
9. 再度 **質問IDマッピングを更新** → 手入力 ID が保持されること
10. **質問IDマッピングを確認** → UNMAPPED / duplicate / mismatch を確認
11. （任意）**今すぐ同期** を押す → **ブロックメッセージ**が表示され、payload が送信されないこと

## Phase 5A — 年次運用（academic_year）

年度ごとに Form を複製する運用では、新 Spreadsheet バインド時に以下を設定します。

| キー | 新年度準備時 | 説明 |
|------|-------------|------|
| `MEMBER_ANALYSIS_FORM_ID` | **新 Form ID** | 複製した Form |
| `MEMBER_ANALYSIS_ACADEMIC_YEAR` | **新年度**（例: `2027`） | 収集年度の正本。Form title や現在日時から推定しない |
| `MEMBER_ANALYSIS_SYNC_ENABLED` | **`false`** | Mapping 監査・dry-run 完了まで sync 禁止 |

v3 sync payload の各 response に `academic_year` が含まれます。  
`questionnaire_version` は引き続き `member-analysis-2026-v3`（定義世代と収集年度は別概念）。

**メンバー分析 → 年度設定プレビュー**（`previewMemberAnalysisAnnualConfig`）で read-only 確認できます。

## Phase 5B — 年度 Form lifecycle

`MEMBER_ANALYSIS_COLLECTION_STATE`（業務状態）と `MEMBER_ANALYSIS_SYNC_ENABLED`（技術装置）を **混同しない**。

| 値 | 意味 |
|----|------|
| `preparing` | 年度 Form 準備中。学生へ正式公開前 |
| `open` | 募集期間中。新規回答受付 + 提出後編集可 |
| `closed` | 締切済み。新規回答・編集停止。final sync 待ち/完了 |

**read-only 監査:** **メンバー分析 → 年度Formライフサイクル監査（開発）**（`previewMemberAnalysisFormLifecycle`）

Phase 5B では Form 設定の **自動変更は行わない**（Google Form UI で人間が設定、GAS は検証のみ）。

### 翌年度 Form 作成 — PREPARE

1. 前年度 Form を複製
2. タイトルを新年度へ変更（例: `研究室希望・自己分析フォーム 2027`）
3. 新しい回答 Spreadsheet をリンク
4. Spreadsheet-bound GAS を作成/コピー
5. `Code.gs` / `SyncHashV3.gs` / Mapping 関連 `.gs` を最新版に反映

6. Script Properties:

   | キー | 値 |
   |------|-----|
   | `MEMBER_ANALYSIS_FORM_ID` | 新 Form ID |
   | `MEMBER_ANALYSIS_ACADEMIC_YEAR` | 新年度（例: `2027`） |
   | `MEMBER_ANALYSIS_COLLECTION_STATE` | `preparing` |
   | `MEMBER_ANALYSIS_SYNC_ENABLED` | `false` |

7. `MEMBER_ANALYSIS_SYNC_ENDPOINT` / `MEMBER_ANALYSIS_SYNC_SECRET` は既存 Production 値を維持

### VALIDATE（公開前）

8. **質問IDマッピングを更新** → Mapping 生成
9. active = 118 / unresolved = 0 / duplicate = 0
10. scale columns audit（`npm run audit:member-analysis-v3-form-scale-columns`）
11. question_version / item master diff 確認
12. **年度設定プレビュー** = PASS
13. **v3 Sync Payload プレビュー** = PASS
14. **v3 Sync Hash 監査** = PASS（空 Form なら response rows = 0 でも正常）
15. **年度Formライフサイクル監査** = PASS（`preparing` 時）

### OPEN（学生案内直前）

Google Form UI で手動確認:

- 回答を1回に制限 = **ON**
- 回答の編集を許可 = **ON**
- 回答受付 = **ON**

Script Properties:

```text
MEMBER_ANALYSIS_COLLECTION_STATE=open
```

sync の Production 動作確認後:

```text
MEMBER_ANALYSIS_SYNC_ENABLED=true
```

**年度Formライフサイクル監査** 期待: `collection_state=open`, accepting/limitOne/edit = true, validation = PASS

### 募集期間中

```text
初回提出 → 新 Sheet row → 新 sync_id → DB INSERT
回答編集 → 同一 Sheet row → stable hash 差分 → 同一 sync_id → DB UPDATE
```

日常監視: 同期状態 / error / pending / Hash 監査

### CLOSE（締切）

1. 事前に pending / error 確認
2. 必要なら中間 sync
3. Google Form **回答受付停止**
4. `MEMBER_ANALYSIS_COLLECTION_STATE=closed`
5. **年度Formライフサイクル監査** → accepting = false, validation = PASS

この時点で `MEMBER_ANALYSIS_SYNC_ENABLED=true` でも可（final sync 用）。

**final sync / 年度確定 / sync disable / trigger 無効化** → Phase 5C へ。

## Vercel Environment Variables

| 変数 | 説明 |
|------|------|
| `MEMBER_ANALYSIS_SYNC_SECRET` | GAS と同じ secret |

## 手動同期（v1 Production Spreadsheet のみ）

v1 本番回答 Sheet（`MEMBER_ANALYSIS_FORM_ID` 未設定）向け:

1. 回答スプレッドシートを開く
2. メニュー **メンバー分析 → 今すぐ同期**
3. 結果ダイアログで synced / failed を確認

## 定期 trigger（v1 Production のみ — 本番は手動設定）

1. GAS エディタ → トリガー → トリガーを追加
2. 実行する関数: `syncMemberAnalysisResponses`
3. イベント: 時間主導型（例: 4時間ごと）
4. **Cursor / 自動デプロイでは trigger を作成しない**
5. **v3 Spreadsheet には Phase 2 まで trigger を設定しない**（既存があれば無効化）

## 同期管理列（シート末尾に自動追加）

| 列名 | 用途 |
|------|------|
| `member_analysis_sync_id` | 回答 UUID（初回のみ採番、不変） |
| `member_analysis_sync_status` | `synced` / `error` / 空 |
| `member_analysis_synced_at` | 最終同期時刻 |
| `member_analysis_sync_hash` | 回答内容 hash（v1: legacy SHA-256 hex / v3: `itemid-v1:` + SHA-256） |
| `member_analysis_sync_error` | エラー概要 |

## 差分同期

次回 sync 対象（いずれか）:

- `member_analysis_sync_id` なし（初回）
- `member_analysis_sync_status` ≠ `synced`
- 回答 hash ≠ `member_analysis_sync_hash`

### v1（`member-analysis-2026-v1`）

- hash = Sheet header ベース `raw_answers` の canonical JSON SHA-256（64 hex、prefix なし）
- Phase 4 以降も **変更なし**

### v3（`member-analysis-2026-v3`）— Phase 4 stable hash

- **書き込み:** 正常 sync 成功時 `itemid-v1:<sha256>`（118 active item_id の semantic answers）
- **判定:** dual-read compatibility bridge
  - stored が `itemid-v1:` → stable hash と比較
  - stored が legacy hex → **legacy hash と一致すれば `needsSync=false`**（一斉再同期防止）
  - 実際に回答変更 → `needsSync=true`、成功時に stable hash へ移行
- hash 対象: `item_id` + `question_version` + raw semantic value（scoring 用数値化なし）
- hash 非対象: sync metadata / `source_header` / Form title / scores 等

## 認証ヘッダー

GAS → Vercel: **`X-Member-Analysis-Secret`**

## 設問 mapping（v1 同期用・従来）

```bash
node scripts/audit-member-analysis-sheet.mjs path/to/form-responses.csv
```

結果を `lib/member-analysis-questionnaire-v1.js` に反映してから本番同期してください。
