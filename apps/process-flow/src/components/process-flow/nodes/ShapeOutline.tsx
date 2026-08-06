"use client";

import type { ShapeKind } from "@/data/process-flow/types";
import type { NodeVisualState } from "./nodeTokens";
import { NODE_BG } from "./nodeTokens";

interface ShapeOutlineProps {
  shape: ShapeKind;
  color: string;
  state: NodeVisualState;
  className?: string;
}

function strokeOpacity(state: NodeVisualState): number {
  if (state === "selected") return 1;
  if (state === "sibling") return 0.35;
  return 0.72;
}

function glow(state: NodeVisualState, color: string): string | undefined {
  if (state === "selected") return `0 0 16px ${color}44, inset 0 0 10px ${color}18`;
  return undefined;
}

/** 図形の輪郭線（SVG または CSS） */
export default function ShapeOutline({ shape, color, state, className = "" }: ShapeOutlineProps) {
  const op = strokeOpacity(state);
  const shadow = glow(state, color);

  if (shape === "capsule") {
    return (
      <span
        className={`pointer-events-none absolute inset-0 rounded-full border-[1.8px] ${className}`}
        style={{
          borderColor: color,
          background: NODE_BG,
          opacity: op,
          boxShadow: shadow,
        }}
        aria-hidden="true"
      />
    );
  }

  if (shape === "rect") {
    return null;
  }

  const polygon =
    shape === "diamond"
      ? "50,4 96,50 50,96 4,50"
      : shape === "hexagon"
        ? "50,3 93,26 93,74 50,97 7,74 7,26"
        : "50,50 50,50";

  return (
    <svg
      className={`pointer-events-none absolute inset-0 h-full w-full ${className}`}
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <polygon
        points={polygon}
        fill={NODE_BG}
        stroke={color}
        strokeWidth={1.8}
        strokeOpacity={op}
        vectorEffect="non-scaling-stroke"
        style={{ filter: shadow ? `drop-shadow(0 0 6px ${color}66)` : undefined }}
      />
    </svg>
  );
}
