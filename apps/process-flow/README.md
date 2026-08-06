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

## ローカル

```bash
npm run build:process-flow && npm run serve
```

http://localhost:8888/process-flow/index.html
