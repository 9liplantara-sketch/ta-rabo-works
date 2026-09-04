"use client";

const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "/process-flow-local";

interface SiteHeaderProps {
  onReset: () => void;
  onBack: () => void;
  canBack: boolean;
}

export default function SiteHeader({ onReset, onBack, canBack }: SiteHeaderProps) {
  return (
    <header className="border-b border-[#1e2530] bg-[#080c10] px-4 py-4">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <a
            href={`${base}/../index.html`}
            className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#38FF78] hover:text-white"
          >
            Portal
          </a>
          <span className="text-[#3a3f48]">/</span>
          <a
            href={`${base}/../ta_rabo_profile.html#analog-section`}
            className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#3485FF] hover:text-white"
          >
            Analog Tools
          </a>
        </div>
        <div className="flex gap-2">
          <HeaderBtn onClick={onBack} disabled={!canBack} label="ひとつ戻る" />
          <HeaderBtn onClick={onReset} label="最初に戻る" />
        </div>
      </div>
      <div className="mx-auto mt-4 max-w-6xl">
        <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-[#38FF78]">
          Process Flow
        </p>
        <h1 className="mt-1 text-xl font-bold tracking-wide text-white md:text-2xl">
          加工フローチャート
        </h1>
        <p className="mt-2 text-sm text-[#9a9a9a]">
          選択肢を辿りながら、目的や材料に合った加工方法を探します。
        </p>
      </div>
    </header>
  );
}

function HeaderBtn({
  onClick,
  label,
  disabled,
}: {
  onClick: () => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded border border-[#1e2530] px-2.5 py-1 font-mono text-[10px] tracking-wider text-[#9a9a9a] transition hover:border-[#38FF78] hover:text-white disabled:opacity-35"
    >
      {label}
    </button>
  );
}
