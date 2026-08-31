#!/usr/bin/env node
/**
 * NEEDS_REVIEW Proposal 行の人間確認 CSV / Markdown 生成
 *
 *   node scripts/generate-member-analysis-v3-mapping-review.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseCsvText } from '../lib/member-analysis-v3-form-mapping.js';
import {
  auditBlockStructure,
  buildReviewRows,
  reviewRowsToCsv,
  reviewRowsToMarkdown,
} from '../lib/member-analysis-v3-mapping-review.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultProposal = path.join(__dirname, '../test/fixtures/member-analysis-v3-item-mapping-proposal.csv');
const defaultReviewCsv = path.join(__dirname, '../test/fixtures/member-analysis-v3-item-mapping-review.csv');
const defaultReviewMd = path.join(__dirname, '../test/fixtures/member-analysis-v3-item-mapping-review.md');

const proposalPath = path.resolve(process.argv[2] || defaultProposal);
const reviewCsvPath = path.resolve(process.argv[3] || defaultReviewCsv);
const reviewMdPath = path.resolve(process.argv[4] || defaultReviewMd);

if (!fs.existsSync(proposalPath)) {
  console.error(`\n✗ Proposal not found: ${proposalPath}\n`);
  process.exit(1);
}

const proposals = parseCsvText(fs.readFileSync(proposalPath, 'utf8'));
const reviewRows = buildReviewRows(proposals);
const blockAudit = auditBlockStructure(proposals);

fs.writeFileSync(reviewCsvPath, reviewRowsToCsv(reviewRows), 'utf8');
fs.writeFileSync(reviewMdPath, reviewRowsToMarkdown(reviewRows, blockAudit), 'utf8');

const counts = { A: 0, B: 0, C: 0, D: 0 };
const actions = {};
for (const row of reviewRows) {
  counts[row.wording_category] = (counts[row.wording_category] || 0) + 1;
  actions[row.recommended_action] = (actions[row.recommended_action] || 0) + 1;
}

console.log('\n=== NEEDS_REVIEW 人間確認資料 ===\n');
console.log(`Proposal:   ${proposalPath}`);
console.log(`Review CSV: ${reviewCsvPath}`);
console.log(`Review MD:  ${reviewMdPath}`);
console.log(`\nNEEDS_REVIEW total: ${reviewRows.length}`);
console.log(`A 表記差: ${counts.A || 0}`);
console.log(`B 長文化: ${counts.B || 0}`);
console.log(`C 意味差: ${counts.C || 0}`);
console.log(`D 尺度文言差: ${counts.D || 0}`);
console.log('\nrecommended_action:');
for (const [k, v] of Object.entries(actions).sort()) {
  console.log(`  ${k}: ${v}`);
}
console.log('\nBlock audit:');
for (const b of blockAudit) {
  console.log(`  ${b.block}: ${b.ok}${b.note ? ` (${b.note})` : ''}`);
}
console.log('\n--- done ---\n');
