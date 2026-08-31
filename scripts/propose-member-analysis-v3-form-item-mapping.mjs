#!/usr/bin/env node
/**
 * 2026 v3 Google Form Mapping ↔ item master 対応候補生成
 *
 * 使い方:
 *   node scripts/propose-member-analysis-v3-form-item-mapping.mjs
 *   node scripts/propose-member-analysis-v3-form-item-mapping.mjs path/to/mapping.csv
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseItemMasterCsv } from '../lib/member-analysis-v3-item-master.js';
import {
  auditMappingStructure,
  auditProposals,
  parseGoogleFormMappingCsv,
  proposeFormItemMappings,
  proposalsToCsv,
} from '../lib/member-analysis-v3-form-mapping.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultMaster = path.join(__dirname, '../test/fixtures/member-analysis-v3-item-master.csv');
const defaultMapping = path.join(__dirname, '../test/fixtures/member-analysis-v3-google-form-mapping.csv');
const defaultProposal = path.join(__dirname, '../test/fixtures/member-analysis-v3-item-mapping-proposal.csv');

const mappingPath = path.resolve(process.argv[2] || defaultMapping);
const masterPath = path.resolve(process.argv[3] || defaultMaster);
const proposalPath = path.resolve(process.argv[4] || defaultProposal);

if (!fs.existsSync(mappingPath)) {
  console.error(`\n✗ Mapping CSV not found: ${mappingPath}\n`);
  process.exit(1);
}
if (!fs.existsSync(masterPath)) {
  console.error(`\n✗ Master CSV not found: ${masterPath}\n`);
  process.exit(1);
}

const masterRows = parseItemMasterCsv(fs.readFileSync(masterPath, 'utf8'));
const mappingRows = parseGoogleFormMappingCsv(fs.readFileSync(mappingPath, 'utf8'));

console.log('\n=== 2026 v3 Form Mapping ↔ master ===\n');
console.log(`Master:   ${masterPath}`);
console.log(`Mapping:  ${mappingPath}`);

const structure = auditMappingStructure(mappingRows, masterRows);
console.log('\n--- A. 入力確認 ---');
console.log(`master rows:            ${structure.stats.masterTotal}`);
console.log(`mapping total rows:     ${structure.stats.mappingTotal}`);
console.log(`mapping active rows:    ${structure.stats.mappingActive}`);
console.log(`mapping inactive rows:  ${structure.stats.mappingInactive}`);
console.log(`Grid items:             ${structure.stats.gridItemCount}`);
console.log(`Grid logical rows:      ${structure.stats.gridLogicalRows}`);
console.log('active response_type:', structure.stats.responseTypeDist);

if (structure.errors.length) {
  console.log('\n--- 構造監査 ERRORS ---');
  structure.errors.forEach((e) => console.error(`  ✗ ${e}`));
  console.log('\n--- ABORT (構造異常のため Proposal 未生成) ---\n');
  process.exit(1);
}

console.log('\n--- 構造監査 PASS ---');

const result = proposeFormItemMappings(mappingRows, masterRows);
if (!result.proposals.length) {
  process.exit(1);
}

fs.writeFileSync(proposalPath, proposalsToCsv(result.proposals), 'utf8');

const { audit } = result;
console.log('\n--- B. 対応結果 ---');
console.log(`proposal rows:          ${audit.stats.proposalRows}`);
console.log(`unique item_id:         ${audit.stats.uniqueItemId}`);
console.log(`AUTO_EXACT:             ${audit.stats.autoExact}`);
console.log(`NEEDS_REVIEW:           ${audit.stats.needsReview}`);
console.log(`UNMATCHED:              ${audit.stats.unmatched}`);
console.log(`duplicate item_id:      ${audit.errors.some((e) => e.includes('duplicate')) ? 'YES' : 0}`);

console.log('\n--- C. 尺度 ---');
console.log(`Big Five:  ${audit.stats.byInstrument.lab_big5}/20`);
console.log(`Values:    ${audit.stats.byInstrument.lab_values}/20`);
console.log(`RF:        ${audit.stats.byInstrument.lab_regulatory_focus}/10`);
console.log(`RIASEC:    ${audit.stats.byInstrument.lab_riasec}/24`);

console.log('\n--- E. 生成ファイル ---');
console.log(`Proposal: ${proposalPath}`);
console.log('Script:   scripts/propose-member-analysis-v3-form-item-mapping.mjs');
console.log('Lib:      lib/member-analysis-v3-form-mapping.js');

if (audit.needsReview.length) {
  console.log('\n--- D. NEEDS_REVIEW 一覧 ---');
  for (const p of audit.needsReview) {
    console.log(`\n[${p.proposed_item_id}] form_order=${p.form_order} method=${p.match_method}`);
    console.log(`  master: ${p.description.slice(0, 100)}`);
    console.log(`  form:   ${(p.row_label || p.source_header).slice(0, 100)}`);
    if (p.match_notes) console.log(`  notes:  ${p.match_notes}`);
  }
}

if (audit.errors.length) {
  console.log('\n--- Proposal 監査 ERRORS ---');
  audit.errors.forEach((e) => console.error(`  ✗ ${e}`));
  process.exit(1);
}

console.log('\n--- PASS (118/118 proposal; 人間確認後に Sheet 反映) ---\n');
