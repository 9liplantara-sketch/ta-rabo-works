import type { NextConfig } from "next";
import path from "node:path";

/** GitHub Pages 本番: /ta-rabo-works/process-flow  ローカル検証: /process-flow-local
 *  Set via NEXT_PUBLIC_BASE_PATH in export:local / export:site scripts.
 *  Published dir process-flow/ is only written by export:site (see scripts/copy-export.mjs).
 */
const basePath =
  process.env.NEXT_PUBLIC_BASE_PATH?.replace(/\/$/, "") || "/process-flow-local";

const nextConfig: NextConfig = {
  output: "export",
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
  basePath,
  assetPrefix: `${basePath}/`,
  images: { unoptimized: true },
  trailingSlash: true,
};

export default nextConfig;
