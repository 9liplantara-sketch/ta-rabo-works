import { cpSync, existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const appDir = resolve(import.meta.dirname, "..");
const outDir = resolve(appDir, "out");
const targetDir = resolve(appDir, "../../process-flow");

if (!existsSync(outDir)) {
  console.error("Missing export output. Run `npm run build` first.");
  process.exit(1);
}

rmSync(targetDir, { recursive: true, force: true });
cpSync(outDir, targetDir, { recursive: true });
console.log(`Copied static export to ${targetDir}`);
