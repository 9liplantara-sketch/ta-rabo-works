"use client";

import { useState } from "react";
import { RGB } from "@/data/process-flow/types";

export default function FlowLegend() {
  const [open, setOpen] = useState(false);

  return (
    <div className="fixed right-4 top-20 z-30 md:top-24">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="rounded border border-[#1e2530] bg-[#080c10dd] px-3.5 py-2 font-mono text-xs tracking-wider text-[#6b7280] hover:border-[#42FF87] hover:text-white"
        aria-expanded={open}
      >
        凡例 {open ? "▲" : "▼"}
      </button>
      {open ? (
        <div className="mt-2 w-56 rounded border border-[#1e2530] bg-[#080c10ee] p-3.5 text-xs text-[#9a9a9a]">
          <LegendRow label="材料" hint="ひし形 · 緑" color={RGB.green} />
          <LegendRow label="加工" hint="四角 · 赤" color={RGB.red} />
          <LegendRow label="加工法" hint="カプセル · 青" color={RGB.blue} />
          <LegendRow label="条件・補助" hint="六角 · 黄" color={RGB.amber} />
          <LegendRow label="接続・合流" hint="小円 · 青" color={RGB.blue} />
          <LegendRow label="関連・代替" hint="点線" dashed />
        </div>
      ) : null}
    </div>
  );
}

function LegendRow({
  label,
  hint,
  color,
  dashed,
}: {
  label: string;
  hint: string;
  color?: string;
  dashed?: boolean;
}) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <span className="flex items-center gap-2 text-white">
        {color ? (
          <span
            className="inline-block h-2.5 w-2.5 rounded-full border"
            style={{ borderColor: color, background: "rgba(0,0,0,0.15)" }}
          />
        ) : dashed ? (
          <span className="inline-block w-5 border-t border-dashed" style={{ borderColor: RGB.blue }} />
        ) : null}
        {label}
      </span>
      <span className="text-[#5a5a5a]">{hint}</span>
    </div>
  );
}
