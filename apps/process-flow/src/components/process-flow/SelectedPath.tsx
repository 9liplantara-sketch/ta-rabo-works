"use client";

import ConnectorNode from "./nodes/ConnectorNode";
import PathNodeChip, { PathConnector, type PathItem } from "./PathNodeChip";

interface SelectedPathProps {
  items: PathItem[];
  onSelect: (optionId: string) => void;
  vertical?: boolean;
  resultLabel?: string | null;
}

export default function SelectedPath({
  items,
  onSelect,
  vertical,
  resultLabel,
}: SelectedPathProps) {
  if (!items.length && !resultLabel) return null;

  return (
    <nav
      className={`pf-path flex items-center gap-0 ${vertical ? "flex-col items-start" : "flex-row flex-wrap"}`}
      aria-label="選択済みの経路"
    >
      {items.map((item, index) => (
        <div
          key={item.id}
          className={`flex items-center ${vertical ? "flex-col items-start" : ""}`}
        >
          {index > 0 ? (
            <span className={`flex items-center ${vertical ? "flex-col py-1.5 pl-5" : ""}`}>
              <PathConnector />
              <ConnectorNode />
            </span>
          ) : null}
          <PathNodeChip
            label={item.label}
            role={item.role}
            onClick={() => onSelect(item.id)}
          />
        </div>
      ))}

      {resultLabel ? (
        <>
          <span className={`flex items-center ${vertical ? "flex-col py-1.5 pl-5" : ""}`}>
            <PathConnector />
            <ConnectorNode />
          </span>
          <PathNodeChip label={resultLabel} role="method" compact />
        </>
      ) : null}
    </nav>
  );
}
