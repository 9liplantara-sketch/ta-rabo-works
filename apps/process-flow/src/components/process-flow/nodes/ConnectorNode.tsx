"use client";

import { RGB } from "@/data/process-flow/types";

/** 小さな円 — 接続点（装飾のみ） */
export default function ConnectorNode() {
  return (
    <span
      className="inline-block h-3 w-3 rounded-full"
      style={{
        background: "rgba(0,0,0,0.15)",
        border: `1.5px solid ${RGB.blue}`,
        opacity: 0.65,
      }}
      aria-hidden="true"
    />
  );
}
