# 光の窓 — 光粒エフェクト（確定版 v21）

記録日: 2026-07-30

## 概要

`index.html` の RGB ベン図を、1 層 canvas の光粒（加算混色）だけで表現する。
CSS 円（`.disk`）は非表示。静止時はキャッシュ画像、操作時は粒シミュレーション。

## ファイル

| ファイル | 役割 |
|---------|------|
| `assets/js/light-window-particles.js` | 光粒本体（cache buster: `?v=21`） |
| `index.html` | canvas 配置、`.has-light-grain`、ラベル text-shadow |

## 見た目（確定）

- **静止時**: チャンネルごと円形 `clip` でアウトラインを滑らかに。RGB / CMY / 白の加算混色。
- **操作時**: 粒ごとにバラバラ集流（gatherOx/Oy、swirl、個体差 spring/damp）。
- **密度**: 基本六角格子 + RGB 単色補充 + 2 色以上重なり補充。`overlap` は初期化時に事前計算。

## 物理パラメータ（v21）

```
SPRING = 0.052
DAMP   = 0.889
GATHER = 0.046
FLOW   = 0.0085
MAX_DRIFT = 0.1
GATHER_R  = 0.39
```

## パフォーマンス

- 静止時: オフスクリーン canvas に 1 回 bake → `drawImage` のみ
- 操作時: カーソル付近の粒のみフル物理、色ごと描画バッチ
- 粒の `channelCountAt` は毎フレーム呼ばず `p.overlap` を使用

## 意図的に採用しなかった案

- CSS 円との 2 層切替（静止時ベン図用）
- 戻り時の飛び散り・重み付け物理（v22 で試行 → 却下）

## ローカル確認

```bash
python3 -m http.server 8765
# http://localhost:8765/index.html
```
