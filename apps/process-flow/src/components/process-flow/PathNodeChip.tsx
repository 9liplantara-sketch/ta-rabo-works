"use client";

import type { NodeRole } from "@/data/process-flow/types";
import { RGB, colorForRole, shapeForRole } from "@/data/process-flow/types";
import ShapeOutline from "./nodes/ShapeOutline";

interface PathNodeChipProps {
  label: string;
  role: NodeRole;
  onClick?: () => void;
  compact?: boolean;
}

/** 選択済み経路用の小型ノード（図形付き） */
export default function PathNodeChip({ label, role, onClick, compact }: PathNodeChipProps) {
  const color = RGB[colorForRole(role)];
  const shape = shapeForRole(role);
  const Tag = onClick ? "button" : "span";

  return (
    <Tag
      {...(onClick ? { type: "button" as const, onClick } : {})}
      className={`relative inline-flex max-w-[11rem] items-center transition-all duration-200 ${onClick ? "cursor-pointer hover:scale-[1.03]" : ""} ${compact ? "min-h-[2.4rem] px-3 py-1.5" : "min-h-[2.75rem] px-4 py-2"}`}
    >
      {shape === "rect" ? (
        <span
          className="absolute inset-0 rounded-[3px] border-[1.5px]"
          style={{ borderColor: color, background: "rgba(0,0,0,0.15)", opacity: 0.85 }}
          aria-hidden="true"
        />
      ) : (
        <ShapeOutline shape={shape} color={color} state="default" />
      )}
      <span
        className={`relative z-[1] line-clamp-2 text-left font-mono leading-tight tracking-wide text-white ${compact ? "text-[11px]" : "text-xs"}`}
        style={{ color: role === "method" ? RGB.blue : undefined }}
      >
        {label}
      </span>
    </Tag>
  );
}

export function PathConnector({ dashed }: { dashed?: boolean }) {
  if (dashed) {
    return (
      <span className="flex items-center px-1.5">
        <span className="pf-path-line-dashed" style={{ borderColor: RGB.blue }} />
      </span>
    );
  }

  return (
    <span className="flex items-center px-1.5">
      <span
        className="pf-path-line-h inline-block"
        style={{ background: RGB.blue, opacity: 0.55 }}
      />
    </span>
  );
}

export type PathItem = {
  id: string;
  label: string;
  role: NodeRole;
};
