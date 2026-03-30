---
name: profile-diagram
description: 田羅義史(ta_rabo)の自己紹介インタラクティブHTML図解を生成・更新する。自己紹介ページ、ポートフォリオ図解、プロフィール可視化、profile diagram、自己紹介図解を作成・更新したいときに使用する。
---

# 田羅義史 / ta_rabo プロフィール図解スキル

## 対象ファイル

```
/Users/ta_rabo/Desktop/自己紹介とスキル/ta_rabo_profile.html
```

---

## 図解の構成

| セクション | 内容 |
|---|---|
| Hero | テンセグリティ風パーティクルアニメーション + 名前・タグライン |
| 01 Philosophy | 4つの哲学カード |
| 02 Activity Map | フォースダイレクテッドノードグラフ（光の加算合成カラー） |
| 03 Works & Timeline | 作品・受賞・活動のタイムライン |
| 04 Domains | 5ドメインカード |

---

## 更新手順

1. ユーザーから追加・変更したい情報を受け取る
2. `ta_rabo_profile.html` を Read で開く
3. StrReplace で該当箇所を編集する

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
| [references/html-snippets.md](references/html-snippets.md) | セクション別の追加用 HTML テンプレート |
