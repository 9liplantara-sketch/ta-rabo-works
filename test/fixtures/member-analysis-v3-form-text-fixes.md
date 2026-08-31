# 2026 v3 — Google Form 文言修正記録

master CSV（`member-analysis-v3-item-master.csv`）を質問文の正本とする。  
Google Form は Cursor から変更しない。ユーザー側で修正後、Mapping 更新 → Proposal 再生成。

## 未修正

| item_id | google_item_id | row_index | 種別 | master（正本） | Form（現状） | 対応 |
|---------|----------------|-----------|------|----------------|-------------|------|
| VAL-BE2 | （Values Grid `1956668441`） | 18 | Grid row | 自分だけでなく、チームや仲間が安心して過ごせることを**大切にしたい**人だ。 | 19. 自分だけでなく、チームや仲間が安心して過ごせることを**大切にする**人だ。 | Form を master wording に合わせる |

### 修正手順（ユーザー）

1. Google Form の Values 尺度 Grid 19行目（`VAL-BE2` 相当）の row 文言を master に合わせる
2. v3 Spreadsheet で「質問IDマッピングを更新」
3. Sheet を export → `test/fixtures/member-analysis-v3-google-form-mapping.csv` を差し替え
4. `npm run propose:member-analysis-v3-form-mapping`
5. `npm run generate:member-analysis-v3-mapping-review`

### Proposal 上の状態（暫定 fixture ベース）

- `review_status`: NEEDS_REVIEW
- `match_method`: GRID_ORDER_STRUCTURAL
- `recommended_action`: FIX_FORM_TEXT
- `wording_category`: D（尺度項目の文言差）
