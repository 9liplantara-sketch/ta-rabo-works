# html-snippets — セクション別の追加用テンプレート

## タイムラインアイテムの追加

`#works-section` 内の `.timeline` に追加する。
新しい `.timeline-item` を追加するだけで IntersectionObserver が自動適用される。

```html
<div class="timeline-item">
  <div class="timeline-year">YYYY.MM</div>
  <span class="timeline-tag tag-exhibition">EXHIBITION</span>
  <div class="timeline-title">作品・活動タイトル</div>
  <div class="timeline-desc">説明文（最大 600px 幅）</div>
</div>
```

タグクラスの種類:

| クラス | 色 | 用途 |
|---|---|---|
| `tag-exhibition` | シアン系 | 展示・発表 |
| `tag-award` | アンバー系 | 受賞 |
| `tag-production` | グリーン系 | 制作・プロダクション |

---

## Philosophy カードの追加

`#philosophy-section` 内の `.philosophy-grid` に追加する。

```html
<div class="phil-card">
  <div class="phil-num">— 005</div>
  <div class="phil-heading">見出し（漢字）</div>
  <div class="phil-text">説明文（1〜3文）</div>
</div>
```

---

## Domains カードの追加

`#domains-section` 内の `.domains-grid` に追加する。

```html
<div class="domain-card">
  <span class="domain-icon">◇</span>
  <div class="domain-name">ドメイン名</div>
  <div class="phil-text" style="font-size:0.82rem; color:var(--mid); line-height:1.8">
    説明文（2〜3文）
  </div>
  <div class="domain-tags">
    <span class="domain-tag">タグ1</span>
    <span class="domain-tag">タグ2</span>
  </div>
</div>
```
