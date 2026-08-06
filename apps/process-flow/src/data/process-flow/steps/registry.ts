import { ALL_STEPS } from "./all-steps";
import type { FlowOption } from "../types";

const OPTION_INDEX = new Map<string, { stepId: string; option: FlowOption }>();

for (const step of ALL_STEPS) {
  for (const option of step.options) {
    OPTION_INDEX.set(option.id, { stepId: step.id, option });
  }
}

export function findOptionById(optionId: string) {
  const entry = OPTION_INDEX.get(optionId);
  if (!entry) return null;
  return { stepId: entry.stepId, option: entry.option };
}
