"use client";

import type { FlowColor } from "@/data/process-flow/types";
import { RGB } from "@/data/process-flow/types";

interface IconSvgProps {
  color: FlowColor;
  children: React.ReactNode;
  className?: string;
}

/** 24×24 統一線画アイコン */
export default function IconSvg({ color, children, className = "" }: IconSvgProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`h-9 w-9 shrink-0 ${className}`}
      aria-hidden="true"
    >
      <g stroke={RGB[color]} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
        {children}
      </g>
    </svg>
  );
}
