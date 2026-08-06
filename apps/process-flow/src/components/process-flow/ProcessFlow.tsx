"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DecisionNode from "@/components/process-flow/nodes/DecisionNode";
import FlowLegend from "@/components/process-flow/FlowLegend";
import OptionNode from "@/components/process-flow/OptionNode";
import ProcessResultView from "@/components/process-flow/ProcessResult";
import SelectedPath from "@/components/process-flow/SelectedPath";
import SiteHeader from "@/components/process-flow/SiteHeader";
import StartEndNode from "@/components/process-flow/nodes/StartEndNode";
import { getResult } from "@/data/process-flow/results";
import {
  getPathLabels,
  getStep,
  resolveCurrentStepId,
  resolveResultId,
} from "@/data/process-flow/steps";
import type { FlowOption } from "@/data/process-flow/types";
import type { NodeVisualState } from "@/components/process-flow/nodes/nodeTokens";

function useVerticalLayout() {
  const [vertical, setVertical] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 768px)");
    const update = () => setVertical(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return vertical;
}

export default function ProcessFlow() {
  const [selectedPath, setSelectedPath] = useState<string[]>([]);
  const [pendingOptionId, setPendingOptionId] = useState<string | null>(null);
  const [fadingIds, setFadingIds] = useState<Set<string>>(new Set());
  const [entering, setEntering] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const vertical = useVerticalLayout();
  const stageRef = useRef<HTMLDivElement>(null);

  const resultId = useMemo(() => resolveResultId(selectedPath), [selectedPath]);
  const currentStepId = useMemo(() => {
    if (resultId) return null;
    return resolveCurrentStepId(selectedPath);
  }, [selectedPath, resultId]);

  const currentStep = currentStepId ? getStep(currentStepId) : null;
  const pathLabels = useMemo(() => getPathLabels(selectedPath), [selectedPath]);
  const result = useMemo(
    () => (resultId ? getResult(resultId) : null),
    [resultId],
  );

  useEffect(() => {
    setEntering(true);
    const timer = window.setTimeout(() => setEntering(false), 480);
    return () => window.clearTimeout(timer);
  }, [currentStepId, resultId]);

  useEffect(() => {
    stageRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [currentStepId, resultId, selectedPath.length]);

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 2400);
  }, []);

  const handleOptionClick = useCallback(
    (option: FlowOption, event: React.MouseEvent<HTMLButtonElement>) => {
      const ripple = event.currentTarget.querySelector(".pf-ripple");
      if (ripple instanceof HTMLElement) {
        ripple.classList.remove("pf-ripple-active");
        void ripple.offsetWidth;
        ripple.classList.add("pf-ripple-active");
      }

      if (option.isImplemented === false) {
        showToast("この分岐は現在準備中です");
        return;
      }

      const siblingIds =
        currentStep?.options.map((o) => o.id).filter((id) => id !== option.id) ?? [];
      setFadingIds(new Set(siblingIds));
      setPendingOptionId(option.id);

      window.setTimeout(() => {
        setSelectedPath((prev) => [...prev, option.id]);
        setFadingIds(new Set());
        setPendingOptionId(null);
      }, 340);
    },
    [currentStep, showToast],
  );

  const handlePathSelect = useCallback((optionId: string) => {
    setSelectedPath((prev) => {
      const index = prev.indexOf(optionId);
      if (index < 0) return prev;
      return prev.slice(0, index + 1);
    });
  }, []);

  const handleReset = useCallback(() => {
    setSelectedPath([]);
    setFadingIds(new Set());
    setPendingOptionId(null);
  }, []);

  const handleBack = useCallback(() => {
    setSelectedPath((prev) => prev.slice(0, -1));
  }, []);

  function optionState(option: FlowOption): NodeVisualState {
    if (fadingIds.has(option.id)) return "fading";
    if (pendingOptionId === option.id) return "selected";
    return "default";
  }

  return (
    <div className="pf-flow-root flex min-h-screen flex-col bg-[#000000] text-white">
      <SiteHeader onReset={handleReset} onBack={handleBack} canBack={selectedPath.length > 0} />
      <FlowLegend />

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-10 px-5 py-7 lg:flex-row lg:py-12">
        <section className="lg:w-[38%] lg:shrink-0">
          <StartEndNode label="加工方法を探す" state="selected" />
          {pathLabels.length > 0 || result ? (
            <div className="mt-5">
              <SelectedPath
                items={pathLabels}
                onSelect={handlePathSelect}
                vertical={vertical}
                resultLabel={result?.name ?? null}
              />
            </div>
          ) : null}
          {resultId ? (
            <div className="mt-5">
              <StartEndNode label="加工方法が見つかりました" state="selected" variant="end" />
            </div>
          ) : null}
        </section>

        <div ref={stageRef} className="min-w-0 flex-1">
          {!resultId && currentStep ? (
            <div className={entering ? "pf-stage-enter" : ""}>
              <DecisionNode question={currentStep.question} entering={entering} />
              <div
                className={`mt-7 grid gap-4 ${
                  currentStep.options.length >= 6
                    ? "sm:grid-cols-2"
                    : "max-w-xl"
                }`}
                role="list"
              >
                {currentStep.options.map((option, index) => (
                  <div
                    key={option.id}
                    role="listitem"
                    style={{ animationDelay: `${index * 100}ms` }}
                  >
                    <OptionNode
                      option={option}
                      state={optionState(option)}
                      entering={entering}
                      onClick={(event) => handleOptionClick(option, event)}
                    />
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {resultId ? (
            <ProcessResultView resultId={resultId} entering={entering} />
          ) : null}
        </div>
      </main>

      {toast ? (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded border border-[#1e2530] bg-[rgba(8,12,16,0.92)] px-4 py-2 font-mono text-[11px] tracking-wide text-[#9a9a9a]">
          {toast}
        </div>
      ) : null}
    </div>
  );
}
