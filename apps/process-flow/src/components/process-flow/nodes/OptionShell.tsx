import type { NodeVisualState } from "./nodeTokens";
import { NODE_BG, accentColor, borderStyle } from "./nodeTokens";
import type { NodeRole, ShapeKind } from "@/data/process-flow/types";
import { shapeForRole } from "@/data/process-flow/types";

interface ShellProps {
  role: NodeRole;
  state: NodeVisualState;
  shape?: ShapeKind;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  ariaLabel: string;
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
  disabled?: boolean;
}

export function OptionShell({
  role,
  state,
  shape,
  onClick,
  ariaLabel,
  className = "",
  style,
  children,
  disabled,
}: ShellProps) {
  const resolvedShape = shape ?? shapeForRole(role);
  const color = accentColor(role);
  const interactive =
    role !== "decision" && role !== "connector" && !disabled;
  const useRectBorder = resolvedShape === "rect";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || role === "decision"}
      className={`pf-option-shell group relative w-full bg-transparent p-0 text-left transition-all duration-300 ${useRectBorder ? "border-[1.8px]" : "border-0"} ${interactive ? "cursor-pointer hover:scale-[1.02]" : "cursor-default"} ${className}`}
      style={{
        background: useRectBorder ? NODE_BG : "transparent",
        ...(useRectBorder ? borderStyle(color, state) : { opacity: state === "fading" ? 0 : state === "sibling" ? 0.32 : 1 }),
        ...style,
      }}
      aria-label={ariaLabel}
    >
      {!useRectBorder ? (
        <span
          className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
          style={{ background: `radial-gradient(circle at 50% 30%, ${color}14 0%, transparent 70%)` }}
        />
      ) : (
        <span
          className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
          style={{ background: `radial-gradient(circle at 50% 30%, ${color}14 0%, transparent 70%)` }}
        />
      )}
      <span className="pf-ripple pointer-events-none absolute inset-0" aria-hidden="true" />
      {children}
    </button>
  );
}
