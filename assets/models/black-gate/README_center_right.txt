黒い扉 追加モデル — 中央／右側

center/black_gate_center.glb : 添付イラスト中央の意匠
right/black_gate_right.glb   : 添付イラスト右側の意匠

前回のblack_gate_v02と同じ寸法・座標・部品名・アニメーション名です。
外枠なし。左右の外端を軸に中央から手前へ開く観音開き。
Door_Left / Door_Right : 左右の扉（ローカルY軸回転）
Particle_000〜Particle_109 : 黒い粒子
Open_4_seconds : 4秒、最大85度まで開く動き＋粒子
座標: Y上、+Z正面。単位m。幅1.68、高さ3.13。

Cursorへの指示例:
既存の黒い扉の読み込み処理を利用し、追加のGLBをそれぞれ別の扉として配置してください。
各モデルを個別の親Groupに入れ、位置・向き・拡大縮小は親Groupで調整してください。
Door_Left/Rightのヒンジ原点やローカル座標は変更しないでください。
部品はシーン全体ではなく各モデルの中で検索し、AnimationMixerも扉ごとに分けてください。
既存のWeb側粒子演出を使用している場合は、GLB内のParticle_*との二重表示を避けてください。
アニメーションは自動ループではなく、現在の操作ロジックに接続してください。

GLBに材質・アニメーションを収録。OBJ/MTLは静的編集用です。
preview.pngは実メッシュの確認画像です。
build_gate.pyとreference.webpで再生成できます（numpy、Pillow、matplotlib）。
画像の線を高さに変換したレリーフであり、低解像度の元画像に由来する細部の粗さがあります。
既存Cursorプロジェクト・スマートフォン実機での動作はこの環境では未確認です。
