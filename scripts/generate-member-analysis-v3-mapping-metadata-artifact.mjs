#!/usr/bin/env node
/**
 * 監査済み Proposal → GAS 用 metadata artifact 生成
 *
 *   npm run generate:member-analysis-v3-mapping-metadata-artifact
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseCsvText } from '../lib/member-analysis-v3-form-mapping.js';
import { proposalRowsToGasMetadataArtifact } from '../lib/member-analysis-v3-mapping-apply.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const proposalPath = path.join(__dirname, '../test/fixtures/member-analysis-v3-item-mapping-proposal.csv');
const outPath = path.join(__dirname, '../gas/member-analysis-sync/QuestionMappingMetadata.gs');

const proposalRows = parseCsvText(fs.readFileSync(proposalPath, 'utf8'));
if (proposalRows.length !== 118) {
  console.error(`\n✗ proposal rows: expected 118, got ${proposalRows.length}\n`);
  process.exit(1);
}

const content = proposalRowsToGasMetadataArtifact(proposalRows);
fs.writeFileSync(outPath, content, 'utf8');

console.log(`\n✓ Generated ${outPath}`);
console.log(`  entries: ${proposalRows.length}`);
console.log('  Remote GAS へは QuestionMapping.gs とセットで手動反映（今回は未反映）\n');
