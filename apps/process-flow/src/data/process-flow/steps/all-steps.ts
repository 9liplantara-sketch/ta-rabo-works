import type { FlowStep } from "../types";
import { action, condition, material, method, methodList } from "./helpers";
import { buildMaterialOptions, moldingMaterialOptions, additiveMaterialOptions } from "../materials";

const category: FlowStep = {
  id: "step-category",
  question: "どの加工から考えますか？",
  options: [
    action("removal", "除去加工", "材料を取り除いて形を作る", "step-removal-purpose"),
    action("joining", "接合・組立", "複数のものをつなぐ", "step-joining-purpose"),
    action("deformation", "変形加工", "材料を曲げたり伸ばしたりする", "step-deformation-purpose"),
    action("molding", "型成形", "型を使って形を作る", "step-molding-purpose"),
    action("additive", "積層造形", "材料を重ねて形を作る", "step-additive-purpose"),
    action("surface", "表面仕上げ・表面処理", "表面の見た目や機能を変える", "step-surface-purpose"),
    action("property", "材料の性質を変える", "硬さや耐熱性などを変える", "step-property-purpose"),
  ],
};

const removal: FlowStep[] = [
  {
    id: "step-removal-purpose",
    question: "材料のどこを取り除きたい？",
    options: [
      action("cut-off", "切り離したい", undefined, "step-cut-style"),
      action("make-hole", "穴をあけたい", undefined, "step-hole-shape"),
      action("make-groove", "溝を作りたい", undefined, "step-groove-shape"),
      action("make-pocket", "くぼみを作りたい", undefined, "step-pocket-depth"),
      action("shape-outline", "外形を削り出したい", undefined, "step-outline-methods"),
      action("thin-down", "薄くしたい", undefined, "step-thin-methods"),
      action("chamfer", "角を落としたい", undefined, "step-chamfer-methods"),
      action("engrave", "文字や模様を彫りたい", undefined, "step-engrave-style"),
    ],
  },
  {
    id: "step-cut-style",
    question: "どのように切りたい？",
    options: [
      action("cut-straight", "直線に切りたい", undefined, "step-cut-methods"),
      action("cut-curve", "曲線に切りたい", undefined, "step-cut-methods"),
      action("cut-free", "自由な形に切りたい", undefined, "step-cut-methods"),
      action("cut-thin", "薄い材料を切りたい", undefined, "step-cut-methods"),
      action("cut-thick", "厚い材料を切りたい", undefined, "step-cut-methods"),
      action("cut-cold", "熱を使わずに切りたい", undefined, "step-cut-methods"),
    ],
  },
  {
    id: "step-cut-methods",
    question: "使える加工方法は？",
    options: methodList("cut", [
      { id: "laser", label: "レーザー切断", resultId: "result-laser" },
      { id: "saw", label: "のこぎり", resultId: "result-jigsaw" },
      { id: "cnc", label: "CNCルーター", resultId: "result-cnc-chisel" },
      { id: "waterjet", label: "ウォータージェット", resultId: "result-waterjet" },
      { id: "shear", label: "シャー／ニブラー", resultId: "result-generic-shear" },
    ]),
  },
  {
    id: "step-hole-shape",
    question: "どんな穴を作りたい？",
    options: [
      action("round-hole", "丸穴", undefined, "step-round-hole-mat"),
      action("square-hole", "四角穴", undefined, "step-square-material"),
      action("slot-hole", "長穴", undefined, "step-slot-methods"),
      action("free-hole", "自由形状の穴", undefined, "step-free-hole-methods"),
      action("through-hole", "貫通穴", undefined, "step-through-methods"),
      action("blind-hole", "止まり穴", undefined, "step-blind-methods"),
      action("micro-hole", "非常に小さな穴", undefined, "step-micro-methods"),
      action("multi-hole", "複数の穴を繰り返し開けたい", undefined, "step-multi-hole-methods"),
    ],
  },
  {
    id: "step-square-material",
    question: "何を加工する？",
    options: buildMaterialOptions("step-wood-equipment", ["wood", "metal", "plastic"], ["wood"]),
  },
  {
    id: "step-wood-equipment",
    question: "どの程度の設備を使える？",
    options: [
      condition("hand-tools", "手工具だけ", undefined, undefined, true),
      condition("power-tools", "電動工具を使える", undefined, undefined, true),
      condition("workshop", "工房設備を使える", undefined, undefined, true),
      condition("cnc", "CNCなどの専門設備を使える", undefined, undefined, true),
    ].map((o) => ({
      ...o,
      nextStepId: undefined,
      resultId:
        o.id === "hand-tools"
          ? "result-drill-chisel"
          : o.id === "power-tools"
            ? "result-jigsaw"
            : o.id === "workshop"
              ? "result-kakunomi-table"
              : "result-cnc-chisel",
    })),
  },
  {
    id: "step-groove-shape",
    question: "どんな溝を作りたい？",
    options: [
      action("groove-straight", "直線の溝", undefined, "step-groove-methods"),
      action("groove-curve", "曲線の溝", undefined, "step-groove-methods"),
      action("groove-v", "V字の溝", undefined, "step-groove-methods"),
      action("groove-u", "U字の溝", undefined, "step-groove-methods"),
      action("groove-slit", "細いスリット", undefined, "step-groove-methods"),
      action("groove-deep", "深い溝", undefined, "step-groove-methods"),
    ],
  },
  {
    id: "step-groove-methods",
    question: "使える加工方法は？",
    options: methodList("groove", [
      { id: "router", label: "ルーター", resultId: "result-cnc-chisel" },
      { id: "chisel", label: "ノミ", resultId: "result-drill-chisel" },
      { id: "milling", label: "フライス", resultId: "result-generic-mill" },
      { id: "laser", label: "レーザー", resultId: "result-laser" },
    ]),
  },
  {
    id: "step-engrave-style",
    question: "どのような表現をしたい？",
    options: [
      action("eng-shallow", "浅く線を彫りたい", undefined, "step-engrave-methods"),
      action("eng-deep", "深く立体的に彫りたい", undefined, "step-engrave-methods"),
      action("eng-text", "文字を刻みたい", undefined, "step-engrave-methods"),
      action("eng-photo", "写真や濃淡を表現したい", undefined, "step-engrave-methods"),
      action("eng-repeat", "同じ模様を繰り返したい", undefined, "step-engrave-methods"),
    ],
  },
  {
    id: "step-engrave-methods",
    question: "使える加工方法は？",
    options: methodList("engrave", [
      { id: "laser", label: "レーザー彫刻", resultId: "result-laser-mark" },
      { id: "cnc", label: "CNC彫刻", resultId: "result-cnc-chisel" },
      { id: "router", label: "ルーター", resultId: "result-cnc-chisel" },
      { id: "hand", label: "手彫り", resultId: "result-generic-hand-carve" },
    ]),
  },
  {
    id: "step-round-hole-mat",
    question: "何を加工する？",
    options: buildMaterialOptions("step-round-hole-methods"),
  },
  {
    id: "step-round-hole-methods",
    question: "使える加工方法は？",
    options: methodList("round", [
      { id: "drill", label: "ドリル", resultId: "result-drill-chisel" },
      { id: "punch", label: "パンチ", resultId: "result-punch" },
      { id: "laser", label: "レーザー", resultId: "result-laser" },
      { id: "bore", label: "ボーリング", resultId: "result-generic-bore" },
    ]),
  },
  {
    id: "step-slot-methods",
    question: "使える加工方法は？",
    options: methodList("slot", [
      { id: "router", label: "ルーター", resultId: "result-cnc-chisel" },
      { id: "jigsaw", label: "ジグソー", resultId: "result-jigsaw" },
      { id: "edm", label: "放電加工", resultId: "result-wire-edm" },
    ]),
  },
  {
    id: "step-free-hole-methods",
    question: "使える加工方法は？",
    options: methodList("freehole", [
      { id: "laser", label: "レーザー切断", resultId: "result-laser" },
      { id: "waterjet", label: "ウォータージェット", resultId: "result-waterjet" },
      { id: "wire-edm", label: "ワイヤ放電", resultId: "result-wire-edm" },
    ]),
  },
  {
    id: "step-through-methods",
    question: "使える加工方法は？",
    options: methodList("through", [
      { id: "drill", label: "ドリル", resultId: "result-drill-chisel" },
      { id: "laser", label: "レーザー", resultId: "result-laser" },
    ]),
  },
  {
    id: "step-blind-methods",
    question: "使える加工方法は？",
    options: methodList("blind", [
      { id: "drill", label: "ドリル", resultId: "result-drill-chisel" },
      { id: "edm", label: "形彫り放電", resultId: "result-die-edm" },
    ]),
  },
  {
    id: "step-micro-methods",
    question: "使える加工方法は？",
    options: methodList("micro", [
      { id: "micro-drill", label: "マイクロドリル", resultId: "result-generic-micro-drill" },
      { id: "laser", label: "レーザー", resultId: "result-laser" },
    ]),
  },
  {
    id: "step-multi-hole-methods",
    question: "使える加工方法は？",
    options: methodList("multi", [
      { id: "cnc", label: "CNC", resultId: "result-cnc-chisel" },
      { id: "punch", label: "パンチ", resultId: "result-punch" },
    ]),
  },
  {
    id: "step-pocket-depth",
    question: "くぼみの深さは？",
    options: [
      action("pocket-shallow", "浅いくぼみ", undefined, "step-groove-methods"),
      action("pocket-deep", "深いくぼみ", undefined, "step-groove-methods"),
    ],
  },
  {
    id: "step-outline-methods",
    question: "使える加工方法は？",
    options: methodList("outline", [
      { id: "cnc", label: "CNC", resultId: "result-cnc-chisel" },
      { id: "laser", label: "レーザー", resultId: "result-laser" },
    ]),
  },
  {
    id: "step-thin-methods",
    question: "使える加工方法は？",
    options: methodList("thin", [
      { id: "sand", label: "研削", resultId: "result-generic-grind" },
      { id: "mill", label: "フライス", resultId: "result-generic-mill" },
    ]),
  },
  {
    id: "step-chamfer-methods",
    question: "使える加工方法は？",
    options: methodList("chamfer", [
      { id: "file", label: "ヤスリ", resultId: "result-drill-file" },
      { id: "router", label: "面取りビット", resultId: "result-cnc-chisel" },
    ]),
  },
];

const joining: FlowStep[] = [
  {
    id: "step-joining-purpose",
    question: "どのようにつなぎたい？",
    options: [
      action("join-removable", "取り外せるようにつなぎたい", undefined, "step-join-removable"),
      action("join-permanent", "永久的に固定したい", undefined, "step-join-permanent-mat"),
      action("join-invisible", "継ぎ目を目立たせず一体化したい", undefined, "step-join-invisible"),
      action("join-no-hole", "穴を開けずにつなぎたい", undefined, "step-join-invisible"),
      action("join-gap", "隙間を埋めながらつなぎたい", undefined, "step-join-invisible"),
      action("join-move", "動く部分を残してつなぎたい", undefined, "step-join-removable"),
      action("join-soft", "柔らかい素材同士をつなぎたい", undefined, "step-join-invisible"),
      action("join-mixed", "異なる素材同士をつなぎたい", undefined, "step-join-permanent-mat"),
    ],
  },
  {
    id: "step-join-removable",
    question: "取り外し方法は？",
    options: methodList("join-r", [
      { id: "screw", label: "ネジ", resultId: "result-generic-screw" },
      { id: "bolt", label: "ボルトとナット", resultId: "result-generic-bolt" },
      { id: "clamp", label: "クランプ", resultId: "result-generic-clamp" },
      { id: "magnet", label: "マグネット", resultId: "result-generic-magnet" },
      { id: "velcro", label: "面ファスナー", resultId: "result-generic-velcro" },
      { id: "fit", label: "はめ込み", resultId: "result-generic-fit" },
      { id: "snap", label: "スナップフィット", resultId: "result-generic-snap" },
    ]),
  },
  {
    id: "step-join-permanent-mat",
    question: "何と何をつなぎますか？",
    options: [
      material("join-wood", "木材同士", "step-join-permanent-methods"),
      material("join-metal", "金属同士", "step-join-permanent-methods"),
      material("join-plastic", "樹脂同士", "step-join-permanent-methods"),
      material("join-paper", "紙や布", "step-join-permanent-methods"),
      material("join-mixed-mat", "異なる素材同士", "step-join-permanent-methods"),
    ],
  },
  {
    id: "step-join-invisible",
    question: "一体化の方法は？",
    options: methodList("join-i", [
      { id: "glue", label: "接着", resultId: "result-generic-glue" },
      { id: "weld", label: "溶接", resultId: "result-generic-weld" },
      { id: "weld-plastic", label: "溶着", resultId: "result-generic-weld-plastic" },
      { id: "braze", label: "ろう付け", resultId: "result-generic-braze" },
      { id: "crimp", label: "圧着", resultId: "result-generic-crimp" },
      { id: "impreg", label: "含浸", resultId: "result-generic-impreg" },
      { id: "resin-inject", label: "樹脂注入", resultId: "result-generic-resin-inject" },
    ]),
  },
  {
    id: "step-join-permanent-methods",
    question: "使える接合方法は？",
    options: methodList("join-p", [
      { id: "glue", label: "接着", resultId: "result-generic-glue" },
      { id: "weld", label: "溶接", resultId: "result-generic-weld" },
      { id: "screw", label: "ネジ", resultId: "result-generic-screw" },
    ]),
  },
];

const deformation: FlowStep[] = [
  {
    id: "step-deformation-purpose",
    question: "どのように形を変えたい？",
    options: [
      action("deform-bend", "曲げたい", undefined, "step-bend-shape"),
      action("deform-fold", "折りたい", undefined, "step-fold-style"),
      action("deform-stretch", "伸ばしたい", undefined, "step-deform-methods"),
      action("deform-compress", "押しつぶしたい", undefined, "step-deform-methods"),
      action("deform-squeeze", "絞りたい", undefined, "step-deform-methods"),
      action("deform-twist", "ねじりたい", undefined, "step-deform-methods"),
      action("deform-coil", "巻きたい", undefined, "step-deform-methods"),
      action("deform-relief", "凹凸を付けたい", undefined, "step-relief-methods"),
      action("deform-bulge", "膨らませたい", undefined, "step-deform-methods"),
    ],
  },
  {
    id: "step-bend-shape",
    question: "何を曲げたい？",
    options: [
      condition("bend-sheet", "板材", "step-bend-methods"),
      condition("bend-bar", "棒材", "step-bend-methods"),
      condition("bend-pipe", "パイプ", "step-bend-methods"),
      condition("bend-wire", "線材", "step-bend-methods"),
      condition("bend-sheet2", "シート", "step-bend-methods"),
      material("bend-wood", "木材", "step-bend-methods"),
      material("bend-plastic", "樹脂板", "step-bend-methods"),
    ],
  },
  {
    id: "step-bend-methods",
    question: "使える加工方法は？",
    options: methodList("bend", [
      { id: "hand", label: "手曲げ", resultId: "result-generic-hand-bend" },
      { id: "press", label: "プレスブレーキ", resultId: "result-generic-press-brake" },
      { id: "heat", label: "加熱曲げ", resultId: "result-generic-heat-bend" },
    ]),
  },
  {
    id: "step-fold-style",
    question: "どのような折り方をしたい？",
    options: [
      action("fold-sharp", "鋭い折り目", undefined, "step-fold-methods"),
      action("fold-soft", "緩やかな折り", undefined, "step-fold-methods"),
      action("fold-multi", "複数回の折り", undefined, "step-fold-methods"),
      action("fold-box", "箱状に折る", undefined, "step-fold-methods"),
      action("fold-acc", "蛇腹状に折る", undefined, "step-fold-methods"),
    ],
  },
  {
    id: "step-fold-methods",
    question: "使える加工方法は？",
    options: methodList("fold", [
      { id: "score", label: "スコアライン", resultId: "result-generic-score" },
      { id: "press", label: "プレス", resultId: "result-generic-press" },
    ]),
  },
  {
    id: "step-relief-methods",
    question: "使える加工方法は？",
    options: methodList("relief", [
      { id: "emboss", label: "エンボス", resultId: "result-generic-emboss" },
      { id: "debos", label: "デボス", resultId: "result-generic-debos" },
      { id: "press", label: "プレス加工", resultId: "result-generic-press" },
      { id: "hammer", label: "槌目", resultId: "result-generic-hammer" },
      { id: "knurl", label: "ローレット", resultId: "result-generic-knurl" },
      { id: "stamp", label: "型押し", resultId: "result-generic-stamp" },
    ]),
  },
  {
    id: "step-deform-methods",
    question: "使える加工方法は？",
    options: methodList("deform", [
      { id: "press", label: "プレス", resultId: "result-generic-press" },
      { id: "hammer", label: "鍛造・槌", resultId: "result-generic-hammer" },
    ]),
  },
];

const molding: FlowStep[] = [
  {
    id: "step-molding-purpose",
    question: "どのような形を作りたい？",
    options: [
      action("mold-solid", "中まで詰まった立体", undefined, "step-molding-material"),
      action("mold-hollow", "中が空洞の立体", undefined, "step-molding-material"),
      action("mold-shell", "薄い殻状の形", undefined, "step-molding-material"),
      action("mold-surface", "表面の凹凸を複製したい", undefined, "step-molding-material"),
      action("mold-complex", "複雑な立体を複製したい", undefined, "step-molding-material"),
      action("mold-small", "同じ形を少量作りたい", undefined, "step-molding-material"),
      action("mold-mass", "同じ形を量産したい", undefined, "step-molding-material"),
      action("mold-soft-tool", "柔らかい型を使いたい", undefined, "step-molding-material"),
    ],
  },
  {
    id: "step-molding-material",
    question: "材料は？",
    options: moldingMaterialOptions("step-molding-methods"),
  },
  {
    id: "step-molding-methods",
    question: "使える加工方法は？",
    options: methodList("mold", [
      { id: "plaster", label: "石膏型による鋳込み", resultId: "result-generic-plaster-cast" },
      { id: "silicone", label: "シリコーン型への樹脂注型", resultId: "result-generic-silicone-cast" },
      { id: "metal-cast", label: "金属鋳造", resultId: "result-generic-metal-cast" },
      { id: "lost-wax", label: "ロストワックス", resultId: "result-generic-lost-wax" },
      { id: "injection", label: "射出成形", resultId: "result-generic-injection" },
      { id: "compression", label: "圧縮成形", resultId: "result-generic-compression" },
      { id: "blow", label: "ブロー成形", resultId: "result-generic-blow" },
      { id: "vacuum", label: "真空成形", resultId: "result-generic-vacuum" },
      { id: "pressure", label: "圧空成形", resultId: "result-generic-pressure-form" },
      { id: "glass-blow", label: "吹きガラス", resultId: "result-generic-glass-blow" },
      { id: "slump", label: "ガラススランピング", resultId: "result-generic-glass-slump" },
    ]),
  },
];

const additive: FlowStep[] = [
  {
    id: "step-additive-purpose",
    question: "何を積み重ねて形を作りますか？",
    options: additiveMaterialOptions("step-additive-priority"),
  },
  {
    id: "step-additive-priority",
    question: "何を重視しますか？",
    options: [
      condition("add-fine", "細かい形状", "step-additive-methods"),
      condition("add-large", "大きな形状", "step-additive-methods"),
      condition("add-strong", "強度", "step-additive-methods"),
      condition("add-smooth", "表面の滑らかさ", "step-additive-methods"),
      condition("add-clear", "透明性", "step-additive-methods"),
      condition("add-fast", "短い制作時間", "step-additive-methods"),
      condition("add-special", "特殊な材料", "step-additive-methods"),
      condition("add-low-waste", "少ない材料ロス", "step-additive-methods"),
    ],
  },
  {
    id: "step-additive-methods",
    question: "使える加工方法は？",
    options: methodList("add", [
      { id: "fdm", label: "FDM／FFF方式", resultId: "result-generic-fdm" },
      { id: "sla", label: "SLA／DLP光造形", resultId: "result-generic-sla" },
      { id: "sls", label: "SLS粉末焼結", resultId: "result-generic-sls" },
      { id: "metal-am", label: "金属3Dプリント", resultId: "result-generic-metal-am" },
      { id: "clay-am", label: "粘土3Dプリント", resultId: "result-generic-clay-am" },
      { id: "paste", label: "ペースト押出", resultId: "result-generic-paste-am" },
      { id: "paper-lam", label: "紙積層", resultId: "result-generic-paper-lam" },
      { id: "sheet-lam", label: "板材積層", resultId: "result-generic-sheet-lam" },
      { id: "frp", label: "FRPハンドレイアップ", resultId: "result-generic-frp" },
      { id: "wind", label: "フィラメントワインディング", resultId: "result-generic-winding" },
    ]),
  },
];

const surface: FlowStep[] = [
  {
    id: "step-surface-purpose",
    question: "表面をどうしたい？",
    options: [
      action("surf-smooth", "滑らかにしたい", undefined, "step-surface-smooth"),
      action("surf-gloss", "光沢を出したい", undefined, "step-surface-smooth"),
      action("surf-mirror", "鏡のようにしたい", undefined, "step-surface-smooth"),
      action("surf-rough", "粗くしたい", undefined, "step-surface-rough"),
      action("surf-color", "色を付けたい", undefined, "step-surface-color"),
      action("surf-pattern", "模様を付けたい", undefined, "step-surface-color"),
      action("surf-protect", "表面を保護したい", undefined, "step-surface-coat"),
      action("surf-metal-look", "金属の質感を付けたい", undefined, "step-surface-coat"),
      action("surf-glass-coat", "ガラス質で覆いたい", undefined, "step-surface-coat"),
      action("surf-durable", "汚れや水に強くしたい", undefined, "step-surface-coat"),
    ],
  },
  {
    id: "step-surface-smooth",
    question: "滑らか・光沢の方法は？",
    options: methodList("smooth", [
      { id: "sand", label: "紙やすり", resultId: "result-generic-sand" },
      { id: "grind", label: "研磨", resultId: "result-generic-grind" },
      { id: "buff", label: "バフ研磨", resultId: "result-generic-buff" },
      { id: "lap", label: "ラッピング", resultId: "result-generic-lap" },
      { id: "barrel", label: "バレル研磨", resultId: "result-generic-barrel" },
      { id: "electro", label: "電解研磨", resultId: "result-generic-electro-polish" },
    ]),
  },
  {
    id: "step-surface-rough",
    question: "粗面加工の方法は？",
    options: methodList("rough", [
      { id: "sandblast", label: "サンドブラスト", resultId: "result-generic-sandblast" },
      { id: "shot", label: "ショットブラスト", resultId: "result-generic-shot" },
      { id: "bead", label: "ビーズブラスト", resultId: "result-generic-bead" },
      { id: "matte", label: "梨地加工", resultId: "result-generic-matte" },
      { id: "hammer", label: "槌目", resultId: "result-generic-hammer" },
      { id: "hairline", label: "ヘアライン", resultId: "result-generic-hairline" },
    ]),
  },
  {
    id: "step-surface-color",
    question: "色や模様の方法は？",
    options: methodList("color", [
      { id: "paint", label: "塗装", resultId: "result-generic-paint" },
      { id: "powder", label: "粉体塗装", resultId: "result-generic-powder-coat" },
      { id: "lacquer", label: "漆", resultId: "result-generic-lacquer" },
      { id: "dye", label: "染色", resultId: "result-generic-dye" },
      { id: "screen", label: "シルクスクリーン", resultId: "result-generic-screen" },
      { id: "inkjet", label: "インクジェット印刷", resultId: "result-generic-inkjet" },
      { id: "uv", label: "UV印刷", resultId: "result-generic-uv-print" },
      { id: "laser-mark", label: "レーザーマーキング", resultId: "result-laser-mark" },
      { id: "foil", label: "箔押し", resultId: "result-generic-foil" },
      { id: "transfer", label: "熱転写", resultId: "result-generic-transfer" },
    ]),
  },
  {
    id: "step-surface-coat",
    question: "表面被覆の方法は？",
    options: methodList("coat", [
      { id: "plate", label: "めっき", resultId: "result-generic-plating" },
      { id: "anodize", label: "アルマイト", resultId: "result-generic-anodize" },
      { id: "pvd", label: "PVD", resultId: "result-generic-pvd" },
      { id: "glaze", label: "釉薬", resultId: "result-generic-glaze" },
      { id: "cloisonne", label: "七宝", resultId: "result-generic-cloisonne" },
      { id: "enamel", label: "ホーロー", resultId: "result-generic-enamel" },
      { id: "oil", label: "オイル仕上げ", resultId: "result-generic-oil" },
      { id: "wax", label: "ワックス仕上げ", resultId: "result-generic-wax" },
    ]),
  },
];

const property: FlowStep[] = [
  {
    id: "step-property-purpose",
    question: "どの性質を変えたい？",
    options: [
      action("prop-hard", "硬くしたい", undefined, "step-property-methods"),
      action("prop-soft", "柔らかくしたい", undefined, "step-property-methods"),
      action("prop-tough", "粘り強くしたい", undefined, "step-property-methods"),
      action("prop-heat", "熱に強くしたい", undefined, "step-property-methods"),
      action("prop-water", "水に強くしたい", undefined, "step-property-methods"),
      action("prop-corrosion", "腐食に強くしたい", undefined, "step-property-methods"),
      action("prop-dry", "乾燥・安定させたい", undefined, "step-property-methods"),
      action("prop-electric", "電気的な性質を変えたい", undefined, "step-property-methods"),
      action("prop-light", "軽くしたい", undefined, "step-property-methods"),
      action("prop-foam", "発泡させたい", undefined, "step-property-methods"),
      action("prop-fire", "燃えにくくしたい", undefined, "step-property-methods"),
    ],
  },
  {
    id: "step-property-methods",
    question: "使える加工方法は？",
    options: methodList("prop", [
      { id: "quench", label: "焼入れ", resultId: "result-generic-quench" },
      { id: "temper", label: "焼戻し", resultId: "result-generic-temper" },
      { id: "anneal", label: "焼鈍", resultId: "result-generic-anneal" },
      { id: "fire-ceramic", label: "焼成", resultId: "result-generic-fire" },
      { id: "sinter", label: "焼結", resultId: "result-generic-sinter" },
      { id: "thermoset", label: "熱硬化", resultId: "result-generic-thermoset" },
      { id: "uv-cure", label: "UV硬化", resultId: "result-generic-uv-cure" },
      { id: "air-dry", label: "自然乾燥", resultId: "result-generic-air-dry" },
      { id: "heat-dry", label: "加熱乾燥", resultId: "result-generic-heat-dry" },
      { id: "carbonize", label: "炭化", resultId: "result-generic-carbonize" },
      { id: "impreg", label: "含浸", resultId: "result-generic-impreg" },
      { id: "foam", label: "発泡", resultId: "result-generic-foam" },
      { id: "wood-heat", label: "木材の熱処理", resultId: "result-generic-wood-heat" },
      { id: "chemical", label: "薬剤処理", resultId: "result-generic-chemical" },
    ]),
  },
];

export const ALL_STEPS: FlowStep[] = [
  category,
  ...removal,
  ...joining,
  ...deformation,
  ...molding,
  ...additive,
  ...surface,
  ...property,
];
