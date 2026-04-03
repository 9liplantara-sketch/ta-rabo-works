---
name: profile-diagram
description: >
  田羅義史(ta_rabo)の自己紹介インタラクティブHTML図解を生成・更新するスキル。
  自己紹介ページ・ポートフォリオ・プロフィール図解の作成・更新時に使用する。
triggers:
  - 自己紹介図解
  - プロフィール図解
  - ta_rabo_profile
  - profile diagram
  - ポートフォリオ図解
  - プロフィール可視化
---

# 田羅義史 / ta_rabo プロフィール図解スキル

## 対象ファイル

```
/Users/ta_rabo/Desktop/tarabo/ta_rabo_profile.html
```

（`tarabo` は `自己紹介とスキル` へのシンボリックリンク。未作成の場合は元フォルダのパスを使ってよい。）

---

## 更新手順

### Step 1 — ユーザーへのヒアリング

作業を始める前に、以下の項目を確認する。

| 確認項目 | 選択肢 / 例 |
|---|---|
| **どのセクションを変更するか** | Hero / Philosophy / Activity Map / Works&Timeline / Domains |
| **操作の種類** | 追加・編集・削除 |
| **Works に追加する場合：タグ種別** | `tag-exhibition`（展示） / `tag-award`（受賞） / `tag-production`（制作） |
| **Activity Map にノードを追加する場合：tier** | 1（ドメイン） / 2（具体活動） |
| **Activity Map にノードを追加する場合：親ノード** | どのノードからエッジを繋ぐか |

未確認の項目があれば聞いてから進む。

### Step 2 — ファイルを開く

`ta_rabo_profile.html` を Read で開く。

### Step 3 — 編集

StrReplace で該当箇所を編集する。
デザイン仕様・screen ブレンドルールは必ず references を参照すること。

---

## 再生成手順（ゼロから作り直す場合）

1. `https://www.t-a-labo.com` と `https://www.t-a-labo.com/news` をフェッチして最新情報を取得
2. Write ツールで HTML を書き込む
3. デザイン仕様・screen ブレンドルールは必ず references を参照すること

---

## References

| ファイル | 内容 |
|---|---|
| [references/design-tokens.md](references/design-tokens.md) | フォント・カラーパレット（SSoT） |
| [references/activity-map.md](references/activity-map.md) | ノードデータ・screen ブレンド実装（SSoT） |
| [references/html-snippets.md](references/html-snippets.md) | ページ構成一覧 + セクション別の追加用 HTML テンプレート |
