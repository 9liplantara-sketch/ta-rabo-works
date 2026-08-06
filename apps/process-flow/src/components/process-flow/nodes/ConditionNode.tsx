"use client";

import type { FlowOption } from "@/data/process-flow/types";
import { OptionShell } from "./OptionShell";
import ShapeOutline from "./ShapeOutline";
import OptionCardBody from "./OptionCardBody";
import type { NodeVisualState } from "./nodeTokens";
import { accentColor } from "./nodeTokens";

interface ConditionNodeProps {
  option: FlowOption;
  state: NodeVisualState;
  entering?: boolean;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
}

/** 黄の六角形 — 条件・補助情報 */
export default function ConditionNode({ option, state, entering, onClick }: ConditionNodeProps) {
  const color = accentColor("condition", option.color);

  return (
    <OptionShell
      role="condition"
      shape="hexagon"
      state={state}
      ariaLabel={option.label}
      onClick={onClick}
      className={entering ? "pf-option-enter" : ""}
    >
      <div className="relative min-h-[4.75rem] px-2 py-4">
        <ShapeOutline shape="hexagon" color={color} state={state} />
        <div className="relative px-3">
          <OptionCardBody
            option={option}
            label={option.label}
            description={option.shortDescription}
          />
        </div>
      </div>
    </OptionShell>
  );
}
