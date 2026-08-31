#!/usr/bin/env node
/**
 * 2026 v3 恒久 item_id マスター CSV 監査（Google Form 非依存）
 *
 * 使い方:
 *   node scripts/audit-member-analysis-v3-item-master.mjs
 *   node scripts/audit-member-analysis-v3-item-master.mjs path/to/master.csv
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  parseItemMasterCsv,
  auditItemMasterRows,
} from '../lib/member-analysis-v3-item-master.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultCsv = path.join(__dirname, '../test/fixtures/member-analysis-v3-item-master.csv');

const csvPath = path.resolve(process.argv[2] || defaultCsv);

if (!fs.existsSync(csvPath)) {
  console.error(`\n✗ CSV not found: ${csvPath}`);
  console.error('  Place the master at test/fixtures/member-analysis-v3-item-master.csv\n');
  process.exit(1);
}

const text = fs.readFileSync(csvPath, 'utf8');
const rows = parseItemMasterCsv(text);
const result = auditItemMasterRows(rows);

console.log('\n=== 2026 v3 item master audit ===\n');
console.log(`CSV: ${csvPath}`);
console.log(`Total rows: ${result.stats.total}`);
console.log(`scoring_included: ${result.stats.scoringIncluded}`);
console.log('By instrument:', JSON.stringify(result.stats.byInstrument, null, 2));
console.log('By scope:', JSON.stringify(result.stats.byScope, null, 2));
console.log(`reverse_scored TRUE: ${result.stats.reverseTrue.length}`);

if (result.warnings.length) {
  console.log('\nWarnings:');
  result.warnings.forEach((w) => console.log(`  ⚠ ${w}`));
}

if (result.errors.length) {
  console.log('\nErrors:');
  result.errors.forEach((e) => console.error(`  ✗ ${e}`));
  console.log(`\n--- FAIL (${result.errors.length} errors) ---\n`);
  process.exit(1);
}

console.log('\n--- PASS ---\n');
