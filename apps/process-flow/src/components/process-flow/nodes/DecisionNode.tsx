"use client";

import { RGB } from "@/data/process-flow/types";

interface DecisionNodeProps {
  question: string;
  entering?: boolean;
}

/** 質問テキスト（図形なし — 材料ひし形と区別） */
export default function DecisionNode({ question, entering }: DecisionNodeProps) {
  return (
    <div
      className={`mx-auto max-w-lg ${entering ? "pf-question-enter" : ""}`}
      aria-live="polite"
    >
      <p
        className="mb-3 font-mono text-xs uppercase tracking-[0.22em]"
        style={{ color: `${RGB.green}99` }}
      >
        Question
      </p>
      <h2 className="text-xl font-bold leading-snug tracking-wide text-white md:text-2xl">
        {question}
      </h2>
      <div
        className="mt-4 h-[2px] w-16"
        style={{ background: `linear-gradient(90deg, ${RGB.red}, ${RGB.green}, ${RGB.blue})` }}
        aria-hidden="true"
      />
    </div>
  );
}
