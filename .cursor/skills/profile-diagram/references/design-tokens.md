# design-tokens — フォント・カラーの定義（SSoT）

## フォント

| 用途 | フォント | 変更可否 |
|---|---|---|
| 日本語本文・見出し | `'Noto Sans JP', sans-serif` | 変更可（ゴシック体を維持） |
| 英語装飾・タグライン | `'Cormorant Garamond', serif` | **変更禁止** |
| ラベル・数字・コード | `'Space Mono', monospace` | **変更禁止** |

> 英字・数字フォント（Cormorant Garamond / Space Mono）のフォントとサイズは変更しない。

Google Fonts import:
```css
@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700&family=Cormorant+Garamond:ital,wght@0,300;0,400;1,300&family=Space+Mono:wght@400;700&display=swap');
```

---

## カラーパレット（CSS カスタムプロパティ）

自己紹介図解は**外向け（公開）ページ**のため、アクセントは **RGB** のみ。  
研究室内 UI（ログイン後）の CMY は使わない。

```css
:root {
  --bg:          #080c10;  /* メイン背景 */
  --bg2:         #0d1117;  /* カード背景 */
  --rgb-red:     #ff4d5e;
  --rgb-green:   #2ee66a;
  --rgb-blue:    #5b7fff;
  --rgb-blue-l:  #8aabff;  /* 見出し・リンク */
  --rgb-blue-d:  #3a5080;  /* セクションラベル */
  --off-white:   #e8e2d8;  /* 本文テキスト・コアノード */
  --mid:         #7a7570;  /* サブテキスト */
}
```

| 用途 | 色 |
|---|---|
| 氏名・見出し・Works CTA | RGB Blue / Blue-light |
| タグライン・補助強調 | RGB Green |
| タイムライン EXHIBITION | Blue |
| タイムライン AWARD | Red |
| タイムライン PRODUCTION | Green |
| Activity Map ドメイン | Art=Red / Craft=Green / Goods=Blue / Research=Blue-light |
| Hero パーティクル | R / G / B を交互 |
