# 2026 v3 fixtures

## Item master (Repository 正本)

配置先:

```text
test/fixtures/member-analysis-v3-item-master.csv
```

元ファイル名: `member-analysis-2026-v3-item-master.csv`

列:

```text
item_id, question_version, scope, instrument, instrument_version,
dimension, reverse_scored, response_type, scale_min, scale_max,
scoring_included, description
```

生成・監査:

```bash
npm run audit:member-analysis-v3-master
npm run generate:member-analysis-v3-items
npm run verify:member-analysis-v3-master
```

## Google Form mapping (GAS Sheet export)

**Phase 1 最終確定版。** Google Sheet で metadata 反映後、「質問IDマッピングを更新」を行い、item_id / metadata 保持を確認した最終 export。

配置先:

```text
test/fixtures/member-analysis-v3-google-form-mapping.csv
```

元ファイル名（export 時）:

```text
価値観分析フォーム（回答） - 質問IDマッピング (3).csv
```

期待値:

```text
data rows = 130
active    = 118
inactive  = 12
active item_id = 118 (UNMAPPED = 0)
```

`member-analysis-v3-google-form-mapping-final.csv` と cell-level **diff = 0**（同一状態）。

対応候補・人間確認:

```bash
npm run propose:member-analysis-v3-form-mapping
npm run generate:member-analysis-v3-mapping-review
```

出力:

```text
test/fixtures/member-analysis-v3-item-mapping-proposal.csv
test/fixtures/member-analysis-v3-item-mapping-review.csv
test/fixtures/member-analysis-v3-item-mapping-review.md
```
