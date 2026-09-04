# 加工のフローチャート

段階選択型 UI。質問に答えながら加工方法へ辿り着きます。

## ノード形状と色

| 形状 | 色 | 役割 |
|------|-----|------|
| ひし形 | 緑 | 材料 |
| 四角 | 赤 | 加工・加工目的 |
| カプセル | 青 | 加工法（最終結果） |
| 六角形 | 黄 | 条件・補助情報 |
| 小円 | 青 | 接続点 |
| 点線 | 青 | 関連・代替ルート |

質問テキストは図形なし（材料のひし形と混同しないため）。

## データ

- `src/data/process-flow/steps/` — 質問と選択肢
- `src/data/process-flow/materials.ts` — 共通材料（role: material）
- `src/data/process-flow/results.ts` — 最終結果

## Build（local と site を分離）

| コマンド | basePath | 出力先 | 用途 |
|----------|----------|--------|------|
| `npm run build:process-flow` | `/process-flow-local` | `process-flow-local/`（gitignore） | ローカル検証 |
| `npm run build:process-flow:site` | `/ta-rabo-works/process-flow` | `process-flow/` | GitHub Pages 公開用 |

`copy-export.mjs` は `PROCESS_FLOW_EXPORT_KIND` と HTML 内の asset path を照合し、local 成果物で `process-flow/` を上書きしないようにしています。

## ローカル

```bash
# local basePath でビルド → 通常の静的サーバ
npm run build:process-flow && npm run serve
# http://localhost:8888/process-flow-local/

# GitHub Pages と同じサブパスで site 成果物を検証
npm run build:process-flow:site && npm run serve:process-flow:site
# http://localhost:8899/ta-rabo-works/process-flow/
```
