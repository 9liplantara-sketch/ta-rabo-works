import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        paper: "#f8f7f4",
        ink: "#1a1f26",
        line: "#d4d0c8",
        muted: "#6b7280",
        removal: "#c45c4a",
        joining: "#4a7c59",
        deformation: "#b8860b",
        molding: "#6b5b95",
        additive: "#2f6f8f",
        surface: "#8b6914",
        property: "#7a4a6a",
      },
      fontFamily: {
        sans: ["var(--font-noto)", "Hiragino Sans", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
