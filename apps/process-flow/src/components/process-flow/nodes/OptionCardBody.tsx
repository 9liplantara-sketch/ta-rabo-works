"use client";

import type { FlowOption } from "@/data/process-flow/types";
import OptionIcon from "../icons/OptionIcon";

interface OptionCardBodyProps {
  option: FlowOption;
  label: string;
  description?: string;
  compact?: boolean;
}

/** ［アイコン］選択肢名 / 補足説明 */
export default function OptionCardBody({
  option,
  label,
  description,
  compact,
}: OptionCardBodyProps) {
  return (
    <div className={`flex items-start gap-3.5 ${compact ? "px-3 py-2" : "px-4 py-3.5"}`}>
      <OptionIcon option={option} />
      <div className="min-w-0 flex-1 pt-0.5">
        <span className="block text-base font-semibold leading-snug text-white">{label}</span>
        {description ? (
          <span className="mt-1 block text-sm leading-relaxed text-[#6b7280]">{description}</span>
        ) : null}
      </div>
    </div>
  );
}
