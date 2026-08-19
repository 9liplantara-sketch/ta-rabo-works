# Phase M3-L — Local Qwen Worker 運用手順

ローカル PC 上の Ollama（`qwen3.6:35b-a3b`）を使い、Vercel 上の定性メンバー分析キューを処理します。

**重要:** Vercel からローカル PC へ直接アクセスすることはありません。Local Worker が Vercel API を poll します。

## 1. 前提

- Production Neon に M3 migration 適用済み
- M3-L migration（`db/migrations/2026-08-member-analysis-local-worker.sql`）適用済み
- Vercel env:
  - `MEMBER_ANALYSIS_AI_PROVIDER=local_worker`
  - `MEMBER_ANALYSIS_WORKER_SECRET`（Worker 専用。sync secret とは別）

## 2. Ollama 起動

```bash
ollama serve
```

## 3. モデル確認

```bash
ollama list
# qwen3.6:35b-a3b が無ければ pull
ollama pull qwen3.6:35b-a3b
```

## 4. Local Worker env

```bash
cp .env.member-analysis-worker.example .env.member-analysis-worker
# MEMBER_ANALYSIS_WORKER_SECRET を Vercel と同じ値に設定
```

`.env.member-analysis-worker` は git に含めません。

## 5. Worker 起動

```bash
npm run member-analysis-worker
```

## 6. 管理画面で分析依頼

1. Lab Manager → Member Analysis
2. メンバー選択 → QUALITATIVE PROFILE
3. 「直近7日をAI分析」
4. キューに `pending` run が作成される
5. Worker が claim → `running` → 完了で `completed`

## 7. 状態遷移

```
pending → running → completed
                 ↘ failed
```

PC が OFF の場合は `pending` のまま。Worker 起動後に自動処理されます。

## 8. Worker 停止

`Ctrl+C`（SIGINT）で安全終了。

## 9. よくある error

| error | 意味 |
|---|---|
| `worker_secret_not_configured` | Vercel に `MEMBER_ANALYSIS_WORKER_SECRET` 未設定 |
| `unauthorized` | Worker secret 不一致 |
| `member_analysis_worker_not_ready` | M3-L migration 未適用 |
| `analysis_input_stale` | 分析中にソース（例: private 化）が変わった → 再分析 |
| `analysis_input_too_large` | 入力が上限超過 → 期間を短くして再分析 |
| `analysis_input_empty` | 対象ソース 0 件 |
| `stale_claim` | 古い claim_token で submit/heartbeat |
| `ollama_unavailable` | Ollama 未起動 |
| `ollama_timeout` | Ollama 応答が timeout（デフォルト 10 分） |
| `ollama_context_limit_reached` | 入力 token が num_ctx 上限付近 → 期間を短くして再分析 |

## 10. Ollama リクエスト設定（Worker 側のみ）

Ollama server / Modelfile は**変更しません**。Worker が `/api/chat` リクエスト単位で指定します。

| 設定 | env | default | 理由 |
|---|---|---|---|
| **NUM_CTX** | `MEMBER_ANALYSIS_OLLAMA_NUM_CTX` | `16384` | Ollama 実効 default 4096 では日報複数件+議事録に不足 |
| **KEEP_ALIVE** | `MEMBER_ANALYSIS_OLLAMA_KEEP_ALIVE` | `10m` | 連続分析時の model reload（約17秒）を抑制 |
| **TIMEOUT** | `MEMBER_ANALYSIS_OLLAMA_TIMEOUT_MS` | `600000`（10分） | 35B の STEP1+STEP2 長時間処理を許容 |
| **PRESENCE PENALTY** | `MEMBER_ANALYSIS_OLLAMA_PRESENCE_PENALTY` | `0` | Modelfile の 1.5 を上書き。抽出タスク向け |
| **TEMPERATURE** | `MEMBER_ANALYSIS_OLLAMA_TEMPERATURE` | `0.1` | 再現性優先 |

**Context 安全策:** 各 STEP の `prompt_eval_count` が `num_ctx - 512` 以上なら `ollama_context_limit_reached` で失敗（candidate 保存なし）。

**Heartbeat:** Ollama 処理中も 60 秒ごとに lease 延長（`MEMBER_ANALYSIS_WORKER_HEARTBEAT_MS`）。

## 11. セキュリティ

- Worker secret を HTML / frontend / git / ログに出さない
- Worker は admin session ではなく secret のみ
- 日報本文は Worker のログに出さない
