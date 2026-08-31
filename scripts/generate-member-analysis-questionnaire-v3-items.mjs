#!/usr/bin/env node
/**
 * CSV マスターから lib/member-analysis-questionnaire-v3-items.js を生成
 *
 * 使い方:
 *   node scripts/generate-member-analysis-questionnaire-v3-items.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  parseItemMasterCsv,
  auditItemMasterRows,
  itemMasterRowToDefinition,
} from '../lib/member-analysis-v3-item-master.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const csvPath = path.join(__dirname, '../test/fixtures/member-analysis-v3-item-master.csv');
const outPath = path.join(__dirname, '../lib/member-analysis-questionnaire-v3-items.js');

if (!fs.existsSync(csvPath)) {
  console.error(`CSV not found: ${csvPath}`);
  process.exit(1);
}

const rows = parseItemMasterCsv(fs.readFileSync(csvPath, 'utf8'));
const audit = auditItemMasterRows(rows);
if (!audit.ok) {
  console.error('CSV audit failed:');
  audit.errors.forEach((e) => console.error(`  ${e}`));
  process.exit(1);
}

const items = rows.map(itemMasterRowToDefinition);

const content = `/**
 * AUTO-GENERATED — do not edit by hand.
 * Source: test/fixtures/member-analysis-v3-item-master.csv
 * Regenerate: npm run generate:member-analysis-v3-items
 */
export const MEMBER_ANALYSIS_QUESTIONNAIRE_V3_ITEMS = ${JSON.stringify(items, null, 2)};
`;

fs.writeFileSync(outPath, content, 'utf8');
console.log(`Generated ${outPath} (${items.length} items)`);
