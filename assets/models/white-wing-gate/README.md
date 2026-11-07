# 白い翼の扉（疑問力・就職の扉）

v6 モデル。寸法は頂点に焼成済み（追加スケール禁止）。

| ファイル | 用途 |
| --- | --- |
| `white_wing_gate.glb` | 高精細（約 23 MB） |
| `white_wing_gate_mobile.glb` | Web 既定・軽量（約 8 MB） |

- ノード: `Door_Left` / `Door_Right` / `Frame`（子に `Frame_Cap_Left`・`Frame_Cap_Right`）
- 開閉: 奥開き（-Z）。左 +85° / 右 -85°。枠は固定
- サイト側: `assets/js/black-gate` の `theme: 'white'`・`opening: 'inward'`（就職の扉 `gate-career`）
- 粒子・白い光の溢れは Web 側で制御（GLB 内アニメは扉角度の参照用）
