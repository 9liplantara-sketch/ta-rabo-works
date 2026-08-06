import type { FlowColor, NodeRole } from "@/data/process-flow/types";
import { RGB, colorForRole } from "@/data/process-flow/types";

export type NodeVisualState = "default" | "selected" | "sibling" | "fading";

export function accentColor(role: NodeRole, override?: FlowColor) {
  return RGB[override ?? colorForRole(role)];
}

export function borderStyle(
  color: string,
  state: NodeVisualState,
): React.CSSProperties {
  switch (state) {
    case "selected":
      return {
        borderColor: color,
        boxShadow: `0 0 0 1px ${color}55, 0 0 16px ${color}44, inset 0 0 12px ${color}18`,
        opacity: 1,
      };
    case "sibling":
      return {
        borderColor: `${color}66`,
        opacity: 0.32,
      };
    case "fading":
      return {
        borderColor: `${color}44`,
        opacity: 0,
        transform: "scale(0.94) translateY(8px)",
      };
    default:
      return {
        borderColor: `${color}aa`,
        opacity: 1,
      };
  }
}

export const NODE_BG = "rgba(0, 0, 0, 0.15)";
