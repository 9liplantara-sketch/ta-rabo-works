#!/usr/bin/env node
/**
 * GAS debugMemberAnalysisV3FormScaleColumns() の JSON 出力 vs canonical label map
 *
 * 使い方:
 *   1. Spreadsheet → メンバー分析 → v3 Form scale columns 診断
 *   2. Logger の JSON を test/fixtures/member-analysis-v3-form-scale-columns-actual.json に保存
 *   3. npm run audit:member-analysis-v3-form-scale-columns
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { auditFormScaleColumnsPayload } from '../lib/member-analysis-v3-form-scale-columns-audit.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(
  __dirname,
  '../test/fixtures/member-analysis-v3-form-scale-columns-actual.json',
);

let failed = 0;

function fail(msg) {
  failed += 1;
  console.error(`  ✗ ${msg}`);
}

function pass(msg) {
  console.log(`  ✓ ${msg}`);
}

console.log('\n=== v3 Form scale columns audit ===\n');
console.log(`fixture: ${fixturePath}`);

if (!fs.existsSync(fixturePath)) {
  fail('fixture missing — run GAS debugMemberAnalysisV3FormScaleColumns() and save Logger JSON');
  console.log('\n=== audit: FAILED (no fixture) ===\n');
  process.exit(1);
}

/** @type {import('../lib/member-analysis-v3-form-scale-columns-audit.js').auditFormScaleColumnsPayload extends Function ? any : never} */
let payload;
try {
  payload = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
} catch (e) {
  fail(`fixture JSON parse error: ${e.message}`);
  process.exit(1);
}

const audit = auditFormScaleColumnsPayload(payload);

for (const result of audit.results) {
  console.log(`\n--- ${result.key} (${result.instrument}) ---`);
  if (result.error) {
    fail(result.error);
    continue;
  }
  console.log(`  column count: actual=${result.actualColumnCount} expected=${result.expectedColumnCount}`);
  console.log(`  row count:    actual=${result.actualRowCount} expected=${result.expectedRowCount}`);
  if (result.match) {
    pass('MATCH (exact column strings)');
    continue;
  }
  fail('DIFF');
  if (result.actualColumnCount !== result.expectedColumnCount) {
    fail(`column count mismatch: ${result.actualColumnCount} vs ${result.expectedColumnCount}`);
  }
  if (result.actualRowCount !== result.expectedRowCount) {
    fail(`row count mismatch: ${result.actualRowCount} vs ${result.expectedRowCount}`);
  }
  for (const d of result.columnDiffs) {
    if (d.kind === 'mismatch') {
      fail(`index ${d.index}: actual=${JSON.stringify(d.actual)} expected=${JSON.stringify(d.expected)}`);
    } else if (d.kind === 'missing_actual') {
      fail(`index ${d.index}: missing actual, expected=${JSON.stringify(d.expected)}`);
    } else if (d.kind === 'extra_actual') {
      fail(`index ${d.index}: extra actual=${JSON.stringify(d.actual)}`);
    }
  }
}

console.log(`\n=== audit: ${audit.ok ? 'ALL MATCH' : 'DIFF FOUND'} ===\n`);
process.exit(audit.ok ? 0 : 1);
