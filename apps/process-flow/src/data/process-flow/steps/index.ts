import { ALL_STEPS } from "./all-steps";
import type { FlowOption, NodeRole } from "../types";
import { findOptionById as findOpt } from "./registry";

export const FLOW_STEPS = ALL_STEPS;
export const STEP_MAP = new Map(FLOW_STEPS.map((step) => [step.id, step]));

export function getStep(id: string) {
  return STEP_MAP.get(id);
}

export function findOptionById(optionId: string) {
  return findOpt(optionId);
}

export function resolveCurrentStepId(path: string[]): string {
  if (path.length === 0) return "step-category";
  const last = findOptionById(path[path.length - 1]!);
  if (!last?.option.nextStepId) {
    if (last?.option.resultId) return "step-category";
    return "step-category";
  }
  return last.option.nextStepId;
}

export function resolveResultId(path: string[]): string | null {
  if (path.length === 0) return null;
  const last = findOptionById(path[path.length - 1]!);
  return last?.option.resultId ?? null;
}

export function getPathLabels(path: string[]): { id: string; label: string; role: NodeRole }[] {
  return path
    .map((id) => {
      const found = findOptionById(id);
      return found
        ? { id, label: found.option.label, role: found.option.role }
        : null;
    })
    .filter(Boolean) as { id: string; label: string; role: NodeRole }[];
}
