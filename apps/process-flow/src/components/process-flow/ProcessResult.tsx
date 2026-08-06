"use client";

import { getAlternativeResults, getResult } from "@/data/process-flow/results";
import type { ProcessResult } from "@/data/process-flow/types";
import { RGB } from "@/data/process-flow/types";
import PathNodeChip, { PathConnector } from "./PathNodeChip";

interface ProcessResultViewProps {
  resultId: string;
  entering?: boolean;
}

export default function ProcessResultView({ resultId, entering }: ProcessResultViewProps) {
  const result = getResult(resultId);
  if (!result) return null;

  const alternatives = getAlternativeResults(result);

  return (
    <section
      className={`mt-8 border-t border-[#1e2530] pt-7 ${entering ? "pf-result-enter" : ""}`}
      aria-label="推奨する加工方法"
    >
      <p className="font-mono text-xs uppercase tracking-[0.2em]" style={{ color: RGB.blue }}>
        Recommended
      </p>
      <div className="mt-4">
        <PathNodeChip label={result.name} role="method" />
      </div>
      {result.alternativeNames?.length ? (
        <p className="mt-3 text-sm text-[#6b7280]">
          代替：{result.alternativeNames.join("、")}
        </p>
      ) : null}
      <p className="mt-4 max-w-2xl text-base leading-relaxed text-[#c8c8c8]">
        {result.summary}
      </p>

      <div className="mt-7 grid gap-6 md:grid-cols-2">
        <ResultBlock title="推奨する理由">
          <BulletList items={result.reasons} />
        </ResultBlock>
        <ResultBlock title="加工の手順">
          <BulletList items={result.steps} />
        </ResultBlock>
        <ResultBlock title="必要な工具">
          <TagList items={result.tools} color={RGB.blue} />
        </ResultBlock>
        <ResultBlock title="対応材料">
          <TagList items={result.materials} color={RGB.green} />
        </ResultBlock>
        <ResultBlock title="制約">
          <BulletList items={result.limitations} muted />
        </ResultBlock>
        <ResultBlock title="安全上の注意">
          <TagList items={result.safetyNotes} color="#ff4050" warn />
        </ResultBlock>
      </div>

      {alternatives.length ? (
        <div className="mt-7">
          <h3 className="font-mono text-xs uppercase tracking-[0.16em] text-[#5a5a5a]">
            関連・代替方法
          </h3>
          <div className="mt-4 flex flex-wrap items-start gap-3">
            {alternatives.map((alt, index) => (
              <div key={alt.id} className="flex items-center">
                {index > 0 ? <PathConnector dashed /> : null}
                <AltCard result={alt} />
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function ResultBlock({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded border border-[#1e2530] bg-[#0e1018] p-4">
      <h3 className="font-mono text-xs uppercase tracking-[0.14em] text-[#5a5a5a]">
        {title}
      </h3>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function BulletList({
  items,
  muted,
}: {
  items: string[];
  muted?: boolean;
}) {
  return (
    <ul className={`list-disc space-y-1 pl-4 text-sm ${muted ? "text-[#6b7280]" : "text-[#c8c8c8]"}`}>
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

function TagList({
  items,
  color,
  warn,
}: {
  items: string[];
  color: string;
  warn?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <span
          key={item}
          className="rounded-[3px] border px-2.5 py-1 text-xs"
          style={{
            borderColor: `${color}${warn ? "66" : "44"}`,
            color: warn ? "#ff8a8a" : color,
          }}
        >
          {item}
        </span>
      ))}
    </div>
  );
}

function AltCard({ result }: { result: ProcessResult }) {
  return (
    <div className="max-w-xs rounded-full border border-dashed px-4 py-2" style={{ borderColor: `${RGB.blue}66` }}>
      <p className="text-sm font-medium" style={{ color: RGB.blue }}>
        {result.name}
      </p>
      <p className="mt-1 text-xs leading-relaxed text-[#6b7280]">{result.summary}</p>
    </div>
  );
}
