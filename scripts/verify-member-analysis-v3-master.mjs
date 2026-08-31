#!/usr/bin/env node
/**
 * CSV マスター ↔ lib/member-analysis-questionnaire-v3.js 完全一致検証
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  parseItemMasterCsv,
  auditItemMasterRows,
  diffItemMasterCsvAndJs,
} from '../lib/member-analysis-v3-item-master.js';
import { getAllV3ItemDefinitions } from '../lib/member-analysis-questionnaire-v3.js';
import { convertNegativeEmotionalityToEmotionalStability } from '../lib/member-analysis-questionnaire-v3.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const csvPath = path.join(__dirname, '../test/fixtures/member-analysis-v3-item-master.csv');

let failed = 0;

function assert(cond, label) {
  if (cond) console.log(`  ✓ ${label}`);
  else { console.error(`  ✗ ${label}`); failed += 1; }
}

console.log('\n=== verify: v3 item master CSV ↔ JS ===\n');

if (!fs.existsSync(csvPath)) {
  console.error(`  ✗ CSV missing: ${csvPath}`);
  process.exit(1);
}

const rows = parseItemMasterCsv(fs.readFileSync(csvPath, 'utf8'));
const audit = auditItemMasterRows(rows);
assert(audit.ok, 'CSV master audit PASS');

const jsItems = getAllV3ItemDefinitions();
assert(jsItems.length === rows.length, `JS item count ${jsItems.length} === CSV ${rows.length}`);

const diffs = diffItemMasterCsvAndJs(rows, jsItems);
if (diffs.length) {
  console.error('\n  CSV ↔ JS diffs:');
  for (const d of diffs.slice(0, 30)) {
    if (d.kind === 'field_mismatch') {
      console.error(`    ${d.item_id}.${d.field}: csv="${d.csv}" js="${d.js}"`);
    } else {
      console.error(`    ${d.kind}: ${d.item_id}`);
    }
  }
  if (diffs.length > 30) console.error(`    ... and ${diffs.length - 30} more`);
  failed += diffs.length;
} else {
  assert(true, 'CSV ↔ JS all fields match');
}

console.log('\n=== emotionalStability conversion (1–7 scale) ===\n');
assert(convertNegativeEmotionalityToEmotionalStability(1) === 7, 'NE 1 → emotionalStability 7');
assert(convertNegativeEmotionalityToEmotionalStability(4) === 4, 'NE 4 → emotionalStability 4');
assert(convertNegativeEmotionalityToEmotionalStability(7) === 1, 'NE 7 → emotionalStability 1');
assert(convertNegativeEmotionalityToEmotionalStability(null) === null, 'NE null → null');

console.log(`\n--- ${failed ? 'FAIL' : 'PASS'} ---\n`);
process.exit(failed ? 1 : 0);
