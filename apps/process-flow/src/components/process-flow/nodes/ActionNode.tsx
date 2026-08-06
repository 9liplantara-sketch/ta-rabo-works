"use client";

import type { FlowOption } from "@/data/process-flow/types";
import { OptionShell } from "./OptionShell";
import OptionCardBody from "./OptionCardBody";
import type { NodeVisualState } from "./nodeTokens";

interface ActionNodeProps {
  option: FlowOption;
  state: NodeVisualState;
  entering?: boolean;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
}

/** 赤い長方形 — 加工・加工目的 */
export default function ActionNode({ option, state, entering, onClick }: ActionNodeProps) {
  return (
    <OptionShell
      role="action"
      shape="rect"
      state={state}
      ariaLabel={option.label}
      onClick={onClick}
      className={`rounded-[3px] ${entering ? "pf-option-enter" : ""}`}
    >
      <OptionCardBody
        option={option}
        label={option.label}
        description={option.shortDescription}
      />
    </OptionShell>
  );
}
