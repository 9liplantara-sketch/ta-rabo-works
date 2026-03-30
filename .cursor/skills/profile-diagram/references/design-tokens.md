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

```css
:root {
  --bg:          #080c10;  /* メイン背景 */
  --bg2:         #0d1117;  /* カード背景 */
  --amber:       #c8a96e;  /* コアノード・アクセント */
  --amber-light: #e8c98e;  /* 見出し文字 */
  --amber-dim:   #7a6240;  /* セクションラベル */
  --cyan:        #5cb8c4;  /* Hero パーティクルのみ使用 */
  --off-white:   #e8e2d8;  /* 本文テキスト */
  --mid:         #7a7570;  /* サブテキスト */
}
```
