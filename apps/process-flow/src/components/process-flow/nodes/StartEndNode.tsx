"use client";

import { RGB } from "@/data/process-flow/types";
import type { NodeVisualState } from "./nodeTokens";

interface StartEndNodeProps {
  label: string;
  state?: NodeVisualState;
  variant?: "start" | "end";
}

export default function StartEndNode({
  label,
  state = "default",
  variant = "start",
}: StartEndNodeProps) {
  const color = variant === "end" ? RGB.blue : RGB.red;

  return (
    <div
      className="inline-flex rounded-full border-[1.8px] px-7 py-3.5 text-center text-sm font-semibold tracking-wide text-white"
      style={{
        background: "rgba(0,0,0,0.15)",
        borderColor: state === "selected" ? color : `${color}aa`,
        boxShadow: state === "selected" ? `0 0 14px ${color}44` : undefined,
      }}
    >
      {label}
    </div>
  );
}
