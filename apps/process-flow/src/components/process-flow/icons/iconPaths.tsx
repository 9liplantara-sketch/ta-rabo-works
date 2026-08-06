/** 各アイコンの SVG パス（24×24 viewBox 内） */

export const ICONS = {
  /* ── 7分類 ── */
  removal: (
    <>
      <rect x="3" y="8" width="14" height="8" rx="0.5" />
      <path d="M17 12h4M20 9l2 3-2 3" />
      <path d="M6 8V6M10 8V5M14 8V6" opacity="0.7" />
    </>
  ),
  joining: (
    <>
      <rect x="3" y="9" width="7" height="6" rx="0.5" />
      <rect x="14" y="9" width="7" height="6" rx="0.5" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <path d="M10 12h4" />
    </>
  ),
  deformation: (
    <>
      <path d="M4 16c4-6 8-6 12 0" />
      <path d="M4 16h16" opacity="0.5" />
    </>
  ),
  molding: (
    <>
      <path d="M6 18V8l6-4 6 4v10" />
      <path d="M9 14h6M9 11h6" />
      <path d="M12 4v3" opacity="0.6" />
    </>
  ),
  additive: (
    <>
      <path d="M5 18h14" />
      <path d="M7 15h10M8 12h8M9 9h6M10 6h4" opacity="0.85" />
      <rect x="16" y="3" width="5" height="5" rx="0.5" opacity="0.5" />
    </>
  ),
  surface: (
    <>
      <rect x="4" y="10" width="16" height="6" rx="0.5" />
      <path d="M8 10c2-3 6-3 8 0" />
      <path d="M6 16h12" opacity="0.5" />
    </>
  ),
  property: (
    <>
      <path d="M12 4v16" opacity="0.4" />
      <path d="M8 8c0-2 2-3 4-3s4 1 4 3-2 3-4 3-4-1-4-3z" />
      <path d="M10 14h4M11 17h2" />
    </>
  ),

  /* ── 除去・目的 ── */
  "cut-off": (
    <>
      <rect x="3" y="9" width="8" height="6" rx="0.5" />
      <rect x="13" y="9" width="8" height="6" rx="0.5" />
      <path d="M11.5 12h1" strokeDasharray="1 1.5" />
    </>
  ),
  "make-hole": (
    <>
      <rect x="4" y="7" width="16" height="10" rx="0.5" />
      <rect x="10" y="10" width="4" height="4" rx="0.5" />
    </>
  ),
  "make-groove": (
    <>
      <rect x="4" y="8" width="16" height="8" rx="0.5" />
      <path d="M7 13h10" strokeWidth={2} />
    </>
  ),
  "make-pocket": (
    <>
      <rect x="4" y="7" width="16" height="10" rx="0.5" />
      <path d="M8 14h8l-2-4H10z" />
    </>
  ),
  "shape-outline": (
    <>
      <rect x="5" y="8" width="14" height="8" rx="0.5" opacity="0.35" />
      <path d="M9 8v8M15 8v8M9 8h6" />
    </>
  ),
  "thin-down": (
    <>
      <rect x="5" y="10" width="14" height="2" rx="0.5" />
      <rect x="5" y="14" width="14" height="4" rx="0.5" opacity="0.4" />
    </>
  ),
  chamfer: (
    <>
      <path d="M6 16V8h8l4 4v4H6z" />
      <path d="M14 8l4 4" />
    </>
  ),
  engrave: (
    <>
      <rect x="4" y="9" width="16" height="7" rx="0.5" />
      <path d="M7 14h3M14 14h3M7 11h10" opacity="0.7" />
    </>
  ),

  /* ── 材料 ── */
  wood: (
    <>
      <rect x="5" y="7" width="14" height="10" rx="0.5" />
      <path d="M8 7v10M12 7v10M16 7v10" opacity="0.6" />
    </>
  ),
  metal: (
    <>
      <rect x="5" y="8" width="10" height="8" rx="0.5" />
      <circle cx="18" cy="15" r="2.5" />
      <path d="M18 12.5V17.5" />
    </>
  ),
  plastic: (
    <>
      <rect x="5" y="8" width="14" height="8" rx="0.5" opacity="0.45" />
      <rect x="5" y="8" width="14" height="8" rx="0.5" />
    </>
  ),
  paper: (
    <>
      <rect x="6" y="9" width="12" height="8" rx="0.5" />
      <rect x="8" y="7" width="12" height="8" rx="0.5" opacity="0.5" />
    </>
  ),
  fabric: (
    <>
      <path d="M6 10c2 2 4 2 6 0s4-2 6 0v8c-2-2-4-2-6 0s-4 2-6 0z" />
    </>
  ),
  leather: (
    <>
      <path d="M6 9c3-2 9-2 12 0v7c-3 2-9 2-12 0z" />
      <path d="M9 12h6" opacity="0.5" />
    </>
  ),
  glass: (
    <>
      <rect x="6" y="7" width="12" height="10" rx="0.5" opacity="0.35" />
      <rect x="6" y="7" width="12" height="10" rx="0.5" />
      <path d="M9 7v10M15 7v10" opacity="0.4" />
    </>
  ),
  ceramic: (
    <>
      <path d="M8 16c0-4 2-6 4-8s4 4 4 8z" />
      <ellipse cx="12" cy="16" rx="5" ry="1.5" />
    </>
  ),
  stone: (
    <>
      <path d="M7 17l3-9 4 3 3-5 3 11z" />
    </>
  ),
  composite: (
    <>
      <rect x="5" y="8" width="14" height="8" rx="0.5" />
      <path d="M5 11h14M5 14h14" />
      <path d="M8 8v8M14 8v8" opacity="0.5" />
    </>
  ),

  /* ── 加工方法 ── */
  laser: (
    <>
      <rect x="4" y="10" width="12" height="6" rx="0.5" />
      <path d="M16 13h4" />
      <path d="M20 11l2 2-2 2" />
      <path d="M18 11v4" opacity="0.5" />
    </>
  ),
  waterjet: (
    <>
      <rect x="4" y="10" width="14" height="6" rx="0.5" />
      <path d="M18 8v8" strokeWidth={1} opacity="0.7" />
      <path d="M17 10l2 2-2 2" />
    </>
  ),
  cnc: (
    <>
      <rect x="4" y="11" width="16" height="5" rx="0.5" />
      <circle cx="10" cy="9" r="2" />
      <path d="M10 11v-1M14 13h6" opacity="0.6" />
    </>
  ),
  drill: (
    <>
      <path d="M12 4v8" />
      <path d="M9 12h6l-1.5 6h-3z" />
      <rect x="5" y="18" width="14" height="2" rx="0.5" opacity="0.4" />
    </>
  ),
  chisel: (
    <>
      <path d="M12 4v6" />
      <path d="M8 10h8l-2 8H10z" />
    </>
  ),
  buff: (
    <>
      <circle cx="8" cy="12" r="4" />
      <rect x="12" y="10" width="10" height="4" rx="0.5" />
      <path d="M16 10c1 1 2 1 3 0" opacity="0.5" />
    </>
  ),
  vacuum: (
    <>
      <path d="M6 14c0-4 3-6 6-6s6 2 6 6" />
      <rect x="8" y="14" width="8" height="4" rx="0.5" />
      <path d="M12 8V5" opacity="0.5" />
    </>
  ),
  saw: (
    <>
      <path d="M6 14c3-6 9-6 12 0" />
      <path d="M6 14h12" />
      <path d="M9 14v-3M12 14v-4M15 14v-3" opacity="0.6" />
    </>
  ),
  weld: (
    <>
      <rect x="4" y="10" width="7" height="5" rx="0.5" />
      <rect x="13" y="10" width="7" height="5" rx="0.5" />
      <path d="M11 12.5h2M11.5 11v3" />
    </>
  ),
  glue: (
    <>
      <rect x="4" y="10" width="7" height="5" rx="0.5" />
      <rect x="13" y="10" width="7" height="5" rx="0.5" />
      <path d="M10 12.5c1 1 3 1 4 0" />
    </>
  ),
  screw: (
    <>
      <circle cx="9" cy="12" r="3" />
      <circle cx="15" cy="12" r="3" />
      <path d="M12 9v6" />
    </>
  ),
  press: (
    <>
      <rect x="6" y="6" width="12" height="3" rx="0.5" />
      <rect x="8" y="12" width="8" height="6" rx="0.5" />
      <path d="M12 9v3" />
    </>
  ),
  fdm: (
    <>
      <path d="M8 18h8M9 15h6M10 12h4M11 9h2" />
      <rect x="15" y="5" width="5" height="6" rx="0.5" opacity="0.5" />
    </>
  ),
  sand: (
    <>
      <rect x="5" y="11" width="14" height="5" rx="0.5" />
      <path d="M7 11c2-2 8-2 10 0" opacity="0.5" />
      <rect x="14" y="6" width="5" height="3" rx="0.5" opacity="0.6" />
    </>
  ),
  paint: (
    <>
      <rect x="5" y="12" width="14" height="5" rx="0.5" />
      <path d="M10 12V8l2-2 2 2v4" />
    </>
  ),
  heat: (
    <>
      <path d="M12 20c-3-2-4-5-2-8 1-2 2-3 2-5 0 2 1 3 2 5 2 3 1 6-2 8z" />
    </>
  ),

  /* ── 汎用フォールバック ── */
  action: (
    <>
      <rect x="5" y="8" width="14" height="8" rx="1" />
      <path d="M9 12h6" />
    </>
  ),
  input: (
    <>
      <path d="M6 9l6-3 6 3v6l-6 3-6-3z" />
    </>
  ),
  method: (
    <>
      <rect x="5" y="7" width="14" height="10" rx="0.5" />
      <rect x="7" y="9" width="10" height="6" rx="0.5" opacity="0.5" />
    </>
  ),
  equipment: (
    <>
      <path d="M8 16V10l4-3 4 3v6" />
      <circle cx="12" cy="13" r="1.5" fill="currentColor" stroke="none" />
    </>
  ),
  hole: (
    <>
      <circle cx="12" cy="12" r="3" />
      <rect x="4" y="7" width="16" height="10" rx="0.5" opacity="0.35" />
    </>
  ),
  bend: (
    <>
      <path d="M5 16c5-8 9-8 14 0" />
    </>
  ),
  fold: (
    <>
      <path d="M5 14h7l2-4 5 4" />
      <path d="M5 14v4h14v-4" opacity="0.5" />
    </>
  ),
} as const;

export type IconKey = keyof typeof ICONS;
