import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * PROCESS_FLOW_EXPORT_KIND=local|site
 * - site  → ../../process-flow        （GitHub Pages 公開用。basePath 必須）
 * - local → ../../process-flow-local  （ローカル検証用。公開 dir を上書きしない）
 */
const kind = process.env.PROCESS_FLOW_EXPORT_KIND;
if (kind !== "local" && kind !== "site") {
  console.error(
    "Set PROCESS_FLOW_EXPORT_KIND=local|site before copying export output.",
  );
  process.exit(1);
}

const appDir = resolve(import.meta.dirname, "..");
const outDir = resolve(appDir, "out");
const targetDir = resolve(
  appDir,
  kind === "site" ? "../../process-flow" : "../../process-flow-local",
);
const expectedBase =
  kind === "site" ? "/ta-rabo-works/process-flow" : "/process-flow-local";

if (!existsSync(outDir)) {
  console.error("Missing export output. Run `next build` first.");
  process.exit(1);
}

const indexHtml = resolve(outDir, "index.html");
if (!existsSync(indexHtml)) {
  console.error("Missing out/index.html after build.");
  process.exit(1);
}

const html = readFileSync(indexHtml, "utf8");
const assetNeedle = `${expectedBase}/_next/`;
if (!html.includes(assetNeedle)) {
  console.error(
    `Export kind "${kind}" expects assets under "${assetNeedle}", but out/index.html does not contain it.`,
  );
  console.error(
    "Refusing to copy — wrong basePath would break GitHub Pages or local serve.",
  );
  process.exit(1);
}

if (kind === "local" && html.includes("/ta-rabo-works/process-flow/_next/")) {
  console.error(
    "Local export unexpectedly contains site basePath. Refusing to copy.",
  );
  process.exit(1);
}

if (kind === "site" && /(?:src|href)="\/process-flow(?:-local)?\/_next\//.test(html)) {
  console.error(
    "Site export still references a local basePath (/process-flow or /process-flow-local). Refusing to copy.",
  );
  process.exit(1);
}

rmSync(targetDir, { recursive: true, force: true });
cpSync(outDir, targetDir, { recursive: true });
writeFileSync(
  resolve(targetDir, ".export-kind"),
  `${kind}\nbasePath=${expectedBase}\n`,
  "utf8",
);
console.log(`Copied ${kind} static export to ${targetDir}`);
console.log(`Verified asset prefix: ${assetNeedle}`);
