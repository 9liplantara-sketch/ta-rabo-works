import type { FlowOption } from "../types";

/** 赤い長方形 — 加工・加工目的 */
export function action(
  id: string,
  label: string,
  shortDescription?: string,
  nextStepId?: string,
  isImplemented = true,
): FlowOption {
  return {
    id,
    label,
    shortDescription,
    role: "action",
    nextStepId,
    isImplemented,
  };
}

/** 緑のひし形 — 材料 */
export function material(
  id: string,
  label: string,
  nextStepId?: string,
  materialId?: string,
  isImplemented = true,
): FlowOption {
  return {
    id,
    label,
    role: "material",
    materialId,
    nextStepId,
    isImplemented,
  };
}

/** 黄の六角形 — 条件・補助情報 */
export function condition(
  id: string,
  label: string,
  nextStepId?: string,
  shortDescription?: string,
  isImplemented = true,
): FlowOption {
  return {
    id,
    label,
    shortDescription,
    role: "condition",
    nextStepId,
    isImplemented,
  };
}

/** @deprecated condition または material を使用 */
export function input(
  id: string,
  label: string,
  nextStepId?: string,
  isImplemented = true,
): FlowOption {
  return condition(id, label, nextStepId, undefined, isImplemented);
}

/** 青いカプセル — 加工方法 */
export function method(
  id: string,
  label: string,
  resultId: string,
  isImplemented = true,
): FlowOption {
  return { id, label, role: "method", resultId, isImplemented };
}

/** 加工方法候補ステップ用 */
export function methodList(
  prefix: string,
  items: { id: string; label: string; resultId: string }[],
): FlowOption[] {
  return items.map((item) => method(`${prefix}-${item.id}`, item.label, item.resultId));
}
