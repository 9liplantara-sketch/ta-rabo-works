import type { FlowOption } from "./types";

export const MATERIAL_OPTIONS = [
  { id: "wood", label: "木材" },
  { id: "metal", label: "金属" },
  { id: "plastic", label: "樹脂" },
  { id: "paper", label: "紙" },
  { id: "fabric", label: "布" },
  { id: "leather", label: "皮革" },
  { id: "glass", label: "ガラス" },
  { id: "ceramic", label: "陶磁器" },
  { id: "stone", label: "石材" },
  { id: "composite", label: "複合材料" },
] as const;

export type MaterialId = (typeof MATERIAL_OPTIONS)[number]["id"];

export function buildMaterialOptions(
  nextStepId: string,
  ids?: MaterialId[],
  implementedIds?: MaterialId[],
): FlowOption[] {
  const list = ids
    ? MATERIAL_OPTIONS.filter((m) => ids.includes(m.id))
    : MATERIAL_OPTIONS;

  return list.map((m) => ({
    id: `mat-${m.id}`,
    label: m.label,
    role: "material" as const,
    materialId: m.id,
    nextStepId,
    // Default matches material()/action()/method(): available unless allow-list is given.
    // Pass implementedIds to keep a subset as "準備中" (e.g. square-hole wood-only).
    isImplemented: implementedIds ? implementedIds.includes(m.id) : true,
  }));
}

function moldingMaterial(id: string, label: string, nextStepId: string): FlowOption {
  return { id, label, role: "material", nextStepId, isImplemented: true };
}

export function moldingMaterialOptions(nextStepId: string): FlowOption[] {
  return [
    moldingMaterial("mat-clay", "粘土・泥漿", nextStepId),
    moldingMaterial("mat-plaster", "石膏", nextStepId),
    moldingMaterial("mat-resin-mold", "樹脂", nextStepId),
    moldingMaterial("mat-rubber", "ゴム", nextStepId),
    moldingMaterial("mat-silicone", "シリコーン", nextStepId),
    moldingMaterial("mat-metal-mold", "金属", nextStepId),
    moldingMaterial("mat-glass-mold", "ガラス", nextStepId),
    moldingMaterial("mat-thermo-sheet", "熱可塑性シート", nextStepId),
  ];
}

export function additiveMaterialOptions(nextStepId: string): FlowOption[] {
  return [
    moldingMaterial("add-filament", "樹脂フィラメント", nextStepId),
    moldingMaterial("add-resin-liq", "液体樹脂", nextStepId),
    moldingMaterial("add-powder", "樹脂粉末", nextStepId),
    moldingMaterial("add-metal-powder", "金属粉末", nextStepId),
    moldingMaterial("add-clay", "粘土・セラミック", nextStepId),
    moldingMaterial("add-paste", "ペースト状材料", nextStepId),
    moldingMaterial("add-sheet", "紙や板材", nextStepId),
    moldingMaterial("add-fiber", "繊維と樹脂", nextStepId),
  ];
}
