"use client";

import type { FlowOption } from "@/data/process-flow/types";
import type { NodeVisualState } from "./nodes/nodeTokens";
import ActionNode from "./nodes/ActionNode";
import ConditionNode from "./nodes/ConditionNode";
import MaterialNode from "./nodes/MaterialNode";
import MethodNode from "./nodes/MethodNode";

interface OptionNodeProps {
  option: FlowOption;
  state: NodeVisualState;
  entering?: boolean;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
}

export default function OptionNode({ option, state, entering, onClick }: OptionNodeProps) {
  switch (option.role) {
    case "method":
      return (
        <MethodNode option={option} state={state} entering={entering} onClick={onClick} />
      );
    case "material":
      return (
        <MaterialNode option={option} state={state} entering={entering} onClick={onClick} />
      );
    case "condition":
      return (
        <ConditionNode option={option} state={state} entering={entering} onClick={onClick} />
      );
    case "action":
    default:
      return (
        <ActionNode option={option} state={state} entering={entering} onClick={onClick} />
      );
  }
}
