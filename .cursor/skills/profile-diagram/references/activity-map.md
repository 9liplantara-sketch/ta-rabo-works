# activity-map — ノードデータ・screen ブレンド実装（SSoT）

## ノードデータ（現在の設定）

```js
const NODES = [
  // tier 0: コア（白 = RGB の合流）
  { id: 0,  label: 'ta_rabo\n田羅義史',      color: '#e8e2d8', r: 36, tier: 0 },
  // tier 1: ドメイン（公開向け RGB）
  { id: 1,  label: 'Art',                    color: '#ff4d5e', r: 24, tier: 1 },  // 赤 R
  { id: 2,  label: 'Craft &\nDesign',        color: '#2ee66a', r: 24, tier: 1 },  // 緑 G
  { id: 3,  label: 'Goods\nta-rabo',         color: '#5b7fff', r: 22, tier: 1 },  // 青 B
  { id: 4,  label: 'Research',               color: '#8aabff', r: 20, tier: 1 },  // 青の明色
  // tier 2: 具体活動（親ドメインの同系色）
  { id: 5,  label: 'SKY SHADE',              color: '#ff7a86', r: 14, tier: 2 },
  { id: 6,  label: 'SKY ROCK',               color: '#ff7a86', r: 14, tier: 2 },
  { id: 7,  label: '膜テンセグリティ\n彫刻', color: '#ff7a86', r: 14, tier: 2 },
  { id: 8,  label: 'DESIGNART\nTOKYO 2025', color: '#ff7a86', r: 13, tier: 2 },
  { id: 9,  label: 'メクリパターン',         color: '#5ef098', r: 16, tier: 2 },
  { id: 10, label: 'Blueprint',              color: '#5ef098', r: 14, tier: 2 },
  { id: 11, label: '日焼けりんご',           color: '#5ef098', r: 12, tier: 2 },
  { id: 12, label: '驚き体験\nの研究',       color: '#a8c0ff', r: 13, tier: 2 },
  { id: 13, label: 'Koreyan\n掲載',          color: '#7a9aff', r: 12, tier: 2 },
];

const EDGES = [
  [0,1],[0,2],[0,3],[0,4],   // コア → ドメイン
  [1,5],[1,6],[1,7],[1,8],   // Art → 作品
  [2,9],[2,10],[2,11],       // Design → 作品
  [3,13],                    // Goods → Koreyan
  [4,12],                    // Research → 研究活動
  [1,2],[2,3],[3,4],         // ドメイン横断エッジ
];
```

---

## tier の色ルール

| tier | 役割 | 推奨 r | 色の基準 |
|------|------|--------|---------|
| 0 | コア | 36 | `#e8e2d8`（白。RGB の合流点） |
| 1 | ドメイン | 20〜26 | 公開向け RGB（`#ff4d5e` / `#2ee66a` / `#5b7fff`）。CMY・黄は使わない |
| 2 | 具体活動 | 12〜16 | 親ドメインの同系色（明度を少し上げた同系） |

---

## ⚠️ screen ブレンドの実装ルール

**ラジアルグラジェントで端をα=0にしてはいけない。**
端がα=0になると screen 合成の計算が崩れ、重なり部分の色が正しくならない。

### 正しい実装

```js
// fill: screen ブレンドで光の加算合成
ctx.save();
ctx.globalCompositeOperation = 'screen';
ctx.beginPath();
ctx.arc(x, y, r, 0, Math.PI * 2);
ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]}, 0.68)`;  // alpha は均一に固定
ctx.fill();
ctx.restore();

// stroke・ラベル: 通常合成（save/restore 外で描画）
```

### screen 合成の結果早見表

| 重なり | 結果 |
|---|---|
| 赤 + 緑 | 黄 |
| 赤 + 青 | マゼンタ |
| 緑 + 青 | シアン |
| 赤 + 緑 + 青 | 白 |

---

## フォースシミュレーションのパラメータ

```js
const REPEL    = 3500 * scale * scale;  // ノード間の反発力
const SPRING_K = 0.06;                  // エッジのバネ定数
const DAMPING  = 0.82;                  // 減衰

const IDEAL = {
  'core-domain': 220 * scale,
  'domain-sub':  160 * scale,
  'cross':       140 * scale,
};
```
