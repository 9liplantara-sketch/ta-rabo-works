#!/usr/bin/env node
/**
 * 監査済み Proposal metadata を Mapping fixture に反映した完成形 CSV を生成・監査
 *
 *   npm run generate:member-analysis-v3-google-form-mapping-final
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseItemMasterCsv } from '../lib/member-analysis-v3-item-master.js';
import {
  auditFinalMappingRows,
  buildFinalMappingRows,
  computeMetadataApplyDiff,
  finalMappingRowsToCsv,
  loadMappingAndProposal,
} from '../lib/member-analysis-v3-mapping-apply.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mappingPath = path.join(__dirname, '../test/fixtures/member-analysis-v3-google-form-mapping.csv');
const proposalPath = path.join(__dirname, '../test/fixtures/member-analysis-v3-item-mapping-proposal.csv');
const masterPath = path.join(__dirname, '../test/fixtures/member-analysis-v3-item-master.csv');
const finalPath = path.join(__dirname, '../test/fixtures/member-analysis-v3-google-form-mapping-final.csv');

const { mappingRows, proposalRows } = loadMappingAndProposal(
  fs.readFileSync(mappingPath, 'utf8'),
  fs.readFileSync(proposalPath, 'utf8'),
);

if (proposalRows.length !== 118) {
  console.error(`\n✗ proposal rows: expected 118, got ${proposalRows.length}\n`);
  process.exit(1);
}

const finalRows = buildFinalMappingRows(mappingRows, proposalRows);
const masterRows = parseItemMasterCsv(fs.readFileSync(masterPath, 'utf8'));
const audit = auditFinalMappingRows(finalRows, masterRows);
const dryRun = computeMetadataApplyDiff(mappingRows, finalRows);

fs.writeFileSync(finalPath, finalMappingRowsToCsv(finalRows), 'utf8');

console.log('\n=== final Mapping CSV ===\n');
console.log(`Output: ${finalPath}`);
console.log(`total:              ${audit.stats.total}`);
console.log(`active:             ${audit.stats.active}`);
console.log(`inactive:           ${audit.stats.inactive}`);
console.log(`active item_id:     ${audit.stats.activeItemId}`);
console.log(`unique item_id:     ${audit.stats.uniqueItemId}`);
console.log(`inactive item_id:   ${audit.stats.inactiveItemId}`);
console.log(`reverse_scored TRUE:  ${audit.stats.reverseScoredTrue}`);
console.log(`metadata diff:      ${audit.stats.metadataDiffCount}`);
console.log('\nscope:', audit.stats.scopeDist);
console.log('instrument:', audit.stats.instrumentDist);

console.log('\n=== dry-run (current → final) ===\n');
console.log(`rows to update:   ${dryRun.rowsToUpdate}`);
console.log(`rows unchanged:   ${dryRun.rowsUnchanged}`);
console.log(`diff entries:     ${dryRun.diffs.length}`);

if (dryRun.diffs.length) {
  console.log('\nSample diffs (first 5):');
  dryRun.diffs.slice(0, 5).forEach((d) => {
    console.log(`  ${d.google_item_id} / row_index=${d.row_index}`);
    d.changes.forEach((c) => console.log(`    ${c.field}: "${c.old}" → "${c.new}"`));
  });
}

if (audit.errors.length) {
  console.log('\n--- ERRORS ---');
  audit.errors.forEach((e) => console.error(`  ✗ ${e}`));
  if (audit.metadataDiffs.length) {
    audit.metadataDiffs.slice(0, 10).forEach((d) => {
      console.error(`    ${d.item_id}.${d.field}: final=${d.final} master=${d.master}`);
    });
  }
  process.exit(1);
}

console.log('\n--- PASS ---\n');
