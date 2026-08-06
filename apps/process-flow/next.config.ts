import type { NextConfig } from "next";
import path from "node:path";

/** ローカル: /process-flow  GitHub Pages 本番: /ta-rabo-works/process-flow */
const basePath =
  process.env.NEXT_PUBLIC_BASE_PATH?.replace(/\/$/, "") || "/process-flow";

const nextConfig: NextConfig = {
  output: "export",
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
  basePath,
  assetPrefix: `${basePath}/`,
  images: { unoptimized: true },
  trailingSlash: true,
};

export default nextConfig;
