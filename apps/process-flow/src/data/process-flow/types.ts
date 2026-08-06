/**
 * ノード形状と色の役割
 *
 * | 形状     | 色     | 役割                         |
 * |----------|--------|------------------------------|
 * | カプセル | 赤/青  | 開始・終了 / 加工法          |
 * | ひし形   | 緑     | 材料                         |
 * | 長方形   | 赤     | 加工・加工目的               |
 * | 六角形   | 黄     | 条件・補助情報               |
 * | 小円     | 青     | 接続点・関連ルート           |
 *
 * 質問テキストは図形なし（読みやすさ優先）。
 */

export type FlowColor = "red" | "green" | "blue" | "amber";

export type NodeRole =
  | "start"
  | "end"
  | "decision"
  | "material"
  | "condition"
  | "action"
  | "method"
  | "connector";

/** @deprecated use material / condition */
export type LegacyInputRole = "input";

export type FlowOption = {
  id: string;
  label: string;
  shortDescription?: string;
  role: NodeRole;
  color?: FlowColor;
  materialId?: string;
  nextStepId?: string;
  resultId?: string;
  isImplemented?: boolean;
};

export type FlowStep = {
  id: string;
  question: string;
  description?: string;
  options: FlowOption[];
};

export type ProcessResult = {
  id: string;
  name: string;
  alternativeNames?: string[];
  summary: string;
  reasons: string[];
  materials: string[];
  tools: string[];
  steps: string[];
  limitations: string[];
  safetyNotes: string[];
  alternativeResultIds: string[];
  relatedProcessIds?: string[];
};

/** 赤=加工 / 緑=材料 / 青=加工法 / 黄=条件 */
export const RGB = {
  red: "#FF4255",
  green: "#42FF87",
  blue: "#4285FF",
  amber: "#FFD042",
} as const;

export const INITIAL_STEP_ID = "step-category";

export type ShapeKind = "rect" | "diamond" | "hexagon" | "capsule" | "circle";

export function shapeForRole(role: NodeRole): ShapeKind {
  switch (role) {
    case "material":
      return "diamond";
    case "condition":
      return "hexagon";
    case "method":
    case "start":
    case "end":
      return "capsule";
    case "connector":
      return "circle";
    case "action":
    default:
      return "rect";
  }
}

export function colorForRole(role: NodeRole): FlowColor {
  if (role === "material") return "green";
  if (role === "condition") return "amber";
  if (role === "method" || role === "connector") return "blue";
  if (role === "action" || role === "start" || role === "end") return "red";
  return "green";
}
