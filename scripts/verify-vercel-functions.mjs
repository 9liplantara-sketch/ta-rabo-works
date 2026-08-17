#!/usr/bin/env node
/**
 * Vercel Hobby plan: max 12 Serverless Functions per deployment.
 * Counts api root .js files and one-level subdir .js files (not lib helpers).
 */
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const API_DIR = path.join(ROOT, 'api');
const HOBBY_LIMIT = 12;

async function listFunctionEntrypoints(dir, prefix = '') {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const ent of entries) {
    const rel = prefix ? `${prefix}/${ent.name}` : ent.name;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (prefix) continue;
      files.push(...await listFunctionEntrypoints(full, ent.name));
    } else if (ent.isFile() && ent.name.endsWith('.js')) {
      files.push(`api/${rel}`);
    }
  }
  return files.sort();
}

const functions = await listFunctionEntrypoints(API_DIR);
const count = functions.length;
const ok = count <= HOBBY_LIMIT;

console.log('\n=== Vercel Function entrypoints (Hobby limit <= 12) ===\n');
functions.forEach((f, i) => console.log(`  ${String(i + 1).padStart(2, ' ')}. ${f}`));
console.log(`\nTotal: ${count} / ${HOBBY_LIMIT} ${ok ? 'OK' : 'OVER LIMIT'}\n`);

if (!ok) {
  console.error(`ERROR: ${count} functions exceeds Hobby limit of ${HOBBY_LIMIT}`);
  process.exit(1);
}

process.exit(0);
