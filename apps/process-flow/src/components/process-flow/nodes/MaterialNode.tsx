"use client";

import type { FlowOption } from "@/data/process-flow/types";
import { OptionShell } from "./OptionShell";
import ShapeOutline from "./ShapeOutline";
import OptionCardBody from "./OptionCardBody";
import type { NodeVisualState } from "./nodeTokens";
import { accentColor } from "./nodeTokens";

interface MaterialNodeProps {
  option: FlowOption;
  state: NodeVisualState;
  entering?: boolean;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
}

/** 緑のひし形 — 材料 */
export default function MaterialNode({ option, state, entering, onClick }: MaterialNodeProps) {
  const color = accentColor("material", option.color);

  return (
    <OptionShell
      role="material"
      shape="diamond"
      state={state}
      ariaLabel={option.label}
      onClick={onClick}
      className={entering ? "pf-option-enter" : ""}
    >
      <div className="relative min-h-[4.5rem] px-2 py-4">
        <ShapeOutline shape="diamond" color={color} state={state} />
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
