"use client";

import type { FlowOption } from "@/data/process-flow/types";
import { OptionShell } from "./OptionShell";
import ShapeOutline from "./ShapeOutline";
import OptionCardBody from "./OptionCardBody";
import type { NodeVisualState } from "./nodeTokens";
import { accentColor } from "./nodeTokens";

interface MethodNodeProps {
  option: FlowOption;
  state: NodeVisualState;
  entering?: boolean;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
}

/** 青いカプセル — 加工方法 */
export default function MethodNode({ option, state, entering, onClick }: MethodNodeProps) {
  const color = accentColor("method", option.color);

  return (
    <OptionShell
      role="method"
      shape="capsule"
      state={state}
      ariaLabel={option.label}
      onClick={onClick}
      className={entering ? "pf-option-enter" : ""}
    >
      <div className="relative min-h-[3.75rem] rounded-full px-2 py-2">
        <ShapeOutline shape="capsule" color={color} state={state} />
        <div className="relative">
          <OptionCardBody option={option} label={option.label} />
        </div>
      </div>
    </OptionShell>
  );
}
