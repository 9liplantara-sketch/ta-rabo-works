import type { FlowOption } from "@/data/process-flow/types";
import type { IconKey } from "./iconPaths";

const EXACT: Record<string, IconKey> = {
  removal: "removal",
  joining: "joining",
  deformation: "deformation",
  molding: "molding",
  additive: "additive",
  surface: "surface",
  property: "property",
  "cut-off": "cut-off",
  "make-hole": "make-hole",
  "make-groove": "make-groove",
  "make-pocket": "make-pocket",
  "shape-outline": "shape-outline",
  "thin-down": "thin-down",
  chamfer: "chamfer",
  engrave: "engrave",
  "hand-tools": "equipment",
  "power-tools": "equipment",
  workshop: "equipment",
  cnc: "cnc",
  "deform-bend": "bend",
  "deform-fold": "fold",
  "deform-relief": "press",
  "surf-smooth": "sand",
  "surf-gloss": "buff",
  "surf-mirror": "buff",
  "surf-rough": "sand",
  "surf-color": "paint",
  "surf-pattern": "paint",
  "prop-hard": "heat",
  "prop-soft": "heat",
  "prop-heat": "heat",
  "prop-foam": "heat",
};

const MATERIAL: Record<string, IconKey> = {
  wood: "wood",
  metal: "metal",
  plastic: "plastic",
  paper: "paper",
  fabric: "fabric",
  leather: "leather",
  glass: "glass",
  ceramic: "ceramic",
  stone: "stone",
  composite: "composite",
};

function suffixKey(id: string, suffix: string, key: IconKey): IconKey | null {
  return id.endsWith(`-${suffix}`) || id.includes(`-${suffix}-`) ? key : null;
}

/** 選択肢 ID からアイコンキーを解決 */
export function resolveIconKey(option: FlowOption): IconKey {
  const { id, materialId, role } = option;

  if (EXACT[id]) return EXACT[id];

  if (materialId && MATERIAL[materialId]) return MATERIAL[materialId];

  if (id.startsWith("mat-")) {
    const mat = id.replace("mat-", "");
    if (MATERIAL[mat]) return MATERIAL[mat];
    if (mat.includes("wood")) return "wood";
    if (mat.includes("metal")) return "metal";
    if (mat.includes("glass")) return "glass";
    if (mat.includes("resin") || mat.includes("plastic")) return "plastic";
    if (mat.includes("clay") || mat.includes("plaster")) return "ceramic";
    if (mat.includes("rubber") || mat.includes("silicone")) return "plastic";
    if (mat.includes("thermo")) return "plastic";
  }

  if (id.startsWith("add-")) {
    if (id.includes("filament") || id.includes("metal-am") || id.includes("clay")) return "fdm";
    if (id.includes("resin") || id.includes("powder")) return "additive";
    if (id.includes("sheet") || id.includes("paper")) return "paper";
    if (id.includes("fiber")) return "composite";
    return "additive";
  }

  if (id.startsWith("join-")) {
    if (id.includes("wood")) return "wood";
    if (id.includes("metal")) return "metal";
    if (id.includes("plastic")) return "plastic";
    if (id.includes("paper")) return "paper";
    return "joining";
  }

  if (id.startsWith("bend-")) {
    if (id.includes("wood")) return "wood";
    if (id.includes("plastic")) return "plastic";
    if (id.includes("pipe")) return "bend";
    return "bend";
  }

  const suffixRules: [string, IconKey][] = [
    ["laser", "laser"],
    ["waterjet", "waterjet"],
    ["wire-edm", "cnc"],
    ["edm", "cnc"],
    ["cnc", "cnc"],
    ["router", "cnc"],
    ["milling", "cnc"],
    ["mill", "cnc"],
    ["drill", "drill"],
    ["chisel", "chisel"],
    ["buff", "buff"],
    ["vacuum", "vacuum"],
    ["saw", "saw"],
    ["jigsaw", "saw"],
    ["weld", "weld"],
    ["glue", "glue"],
    ["screw", "screw"],
    ["bolt", "screw"],
    ["clamp", "equipment"],
    ["magnet", "equipment"],
    ["velcro", "fabric"],
    ["fit", "joining"],
    ["snap", "joining"],
    ["press", "press"],
    ["fdm", "fdm"],
    ["sla", "fdm"],
    ["sls", "additive"],
    ["sand", "sand"],
    ["grind", "sand"],
    ["paint", "paint"],
    ["powder", "paint"],
    ["lacquer", "paint"],
    ["dye", "paint"],
    ["screen", "paint"],
    ["foil", "paint"],
    ["transfer", "paint"],
    ["emboss", "press"],
    ["debos", "press"],
    ["hammer", "press"],
    ["stamp", "press"],
    ["injection", "molding"],
    ["compression", "molding"],
    ["blow", "molding"],
    ["cast", "molding"],
    ["silicone", "molding"],
    ["plaster", "molding"],
    ["quench", "heat"],
    ["temper", "heat"],
    ["anneal", "heat"],
    ["fire", "heat"],
    ["sinter", "heat"],
    ["thermoset", "heat"],
    ["uv-cure", "heat"],
    ["carbonize", "heat"],
    ["foam", "heat"],
    ["punch", "drill"],
    ["bore", "drill"],
    ["file", "chisel"],
    ["hand", "equipment"],
    ["score", "fold"],
  ];

  for (const [suffix, key] of suffixRules) {
    if (suffixKey(id, suffix, key)) return key;
  }

  if (id.includes("hole") || id.includes("round-hole") || id.includes("square-hole")) return "make-hole";
  if (id.includes("groove") || id.includes("slot")) return "make-groove";
  if (id.includes("pocket")) return "make-pocket";
  if (id.includes("cut") || id.includes("outline") || id.includes("thin")) return "cut-off";
  if (id.includes("engrave") || id.includes("eng-")) return "engrave";
  if (id.includes("fold")) return "fold";
  if (id.includes("bend") || id.includes("deform")) return "bend";
  if (id.includes("join") || id.includes("connect")) return "joining";
  if (id.includes("mold")) return "molding";
  if (id.includes("surf") || id.includes("coat") || id.includes("plate")) return "surface";
  if (id.includes("prop")) return "heat";

  if (role === "method") return "method";
  if (role === "material" || role === "condition") return "input";
  return "action";
}
