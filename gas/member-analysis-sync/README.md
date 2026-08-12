# メンバー分析 — Google Form 回答シート同期 GAS

価値観分析フォームの **回答スプレッドシート専用** です。  
`gas/seminar-reminder/`（研究会日程・LINE）とは **完全に別** の Apps Script プロジェクトとしてデプロイしてください。

## 対象

- Google Form から自動生成される回答スプレッドシート
- デフォルトシート名: `フォームの回答 1`（先頭シートにフォールバック）

## Script Properties（必須）

GAS エディタ → プロジェクトの設定 → スクリプト プロパティ

| キー | 値の例 | 説明 |
|------|--------|------|
| `MEMBER_ANALYSIS_SYNC_ENDPOINT` | `https://ta-rabo-works.vercel.app/api/psych-assessments/sync` | Vercel sync API |
| `MEMBER_ANALYSIS_SYNC_SECRET` | （Vercel `MEMBER_ANALYSIS_SYNC_SECRET` と同一のランダム文字列） | 同期認証 |

**Secret の実値を README や Git に書かないでください。**

## Vercel Environment Variables

| 変数 | 説明 |
|------|------|
| `MEMBER_ANALYSIS_SYNC_SECRET` | GAS と同じ secret |

## 手動同期

1. 回答スプレッドシートを開く
2. メニュー **メンバー分析 → 今すぐ同期**
3. 結果ダイアログで synced / failed を確認

## 定期 trigger（本番は手動設定）

1. GAS エディタ → トリガー → トリガーを追加
2. 実行する関数: `syncMemberAnalysisResponses`
3. イベント: 時間主導型（例: 4時間ごと）
4. **Cursor / 自動デプロイでは trigger を作成しない**

## 同期管理列（シート末尾に自動追加）

| 列名 | 用途 |
|------|------|
| `member_analysis_sync_id` | 回答 UUID（初回のみ採番、不変） |
| `member_analysis_sync_status` | `synced` / `error` / 空 |
| `member_analysis_synced_at` | 最終同期時刻 |
| `member_analysis_sync_hash` | 回答内容 SHA-256 |
| `member_analysis_sync_error` | エラー概要 |

列位置は固定しません。ヘッダー名で解決します。

## 差分同期

次回 sync 対象（いずれか）:

- `member_analysis_sync_id` なし（初回）
- `member_analysis_sync_status` ≠ `synced`（`error` / 空 / pending — 内容未変更でも error は再試行）
- 回答 hash ≠ `member_analysis_sync_hash`（編集検知）

`synced` かつ hash 一致 → skip

## 同時実行防止

`syncMemberAnalysisResponses()` 冒頭で `LockService.getDocumentLock()` を使用。  
定期 trigger と **メンバー分析 → 今すぐ同期** が重なった場合、lock 取得できなければ二重実行せず終了。  
Neon 側は `UNIQUE(source, source_response_id)` UPSERT で二段構え。

## 認証ヘッダー

GAS → Vercel: **`X-Member-Analysis-Secret`**（値は Script Properties / Vercel env と同一）

## バッチ

- `SYNC_BATCH_SIZE = 50`
- `SYNC_MAX_ROWS_PER_RUN = 200`

## エラー確認

1. `member_analysis_sync_error` 列
2. `/api/health` → `has_psych_assessments_table`
3. Neon migration 未適用時は sync 失敗

## 設問 mapping

```bash
node scripts/audit-member-analysis-sheet.mjs path/to/form-responses.csv
```

結果を `lib/member-analysis-questionnaire-v1.js` に反映してから本番同期してください。
