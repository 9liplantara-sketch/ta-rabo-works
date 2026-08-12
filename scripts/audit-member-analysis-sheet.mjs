#!/usr/bin/env node
/**
 * Google Form 回答 CSV のヘッダー監査（questionnaire v1 全列分類）
 *
 * 使い方:
 *   node scripts/audit-member-analysis-sheet.mjs path/to/form-responses.csv
 */
import fs from 'fs';
import path from 'path';
import {
  MEMBER_ANALYSIS_QUESTIONNAIRE_V1,
  getScoringHeadersFromConfig,
} from '../lib/member-analysis-questionnaire-v1.js';
import { normalizeHeaderKey } from '../lib/member-analysis-scoring.js';
import {
  classifyAllSheetHeaders,
  HEADER_CATEGORY,
} from '../lib/member-analysis-sheet-headers.js';

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

function loadHeaders(csvPath) {
  const text = fs.readFileSync(csvPath, 'utf8').replace(/^\uFEFF/, '');
  const firstLine = text.split(/\r?\n/)[0];
  if (!firstLine) throw new Error('empty csv');
  return parseCsvLine(firstLine).map((h) => h.trim());
}

function headerSet(headers) {
  return new Set(headers.map(normalizeHeaderKey));
}

function findInSheet(sheetHeaders, target) {
  return headerSet(sheetHeaders).has(normalizeHeaderKey(target));
}

const CATEGORY_LABELS = {
  [HEADER_CATEGORY.SCORING]: 'scoring',
  [HEADER_CATEGORY.META]: 'meta',
  [HEADER_CATEGORY.CONTEXTUAL]: 'contextual',
  [HEADER_CATEGORY.OBSOLETE_SCORING_EXCLUDED]: 'obsolete_scoring_excluded',
  [HEADER_CATEGORY.LEGACY_IGNORED]: 'legacy_ignored',
  [HEADER_CATEGORY.SYNC]: 'sync',
  [HEADER_CATEGORY.UNKNOWN]: 'unknown',
  [HEADER_CATEGORY.EMPTY]: 'empty',
};

function main() {
  const csvPath = process.argv[2];
  if (!csvPath) {
    console.error('Usage: node scripts/audit-member-analysis-sheet.mjs <form-responses.csv>');
    process.exit(1);
  }

  const cfg = MEMBER_ANALYSIS_QUESTIONNAIRE_V1;
  const abs = path.resolve(csvPath);
  const sheetHeaders = loadHeaders(abs);
  const { byCategory, counts, unknown } = classifyAllSheetHeaders(sheetHeaders, cfg);

  const requiredScoring = getScoringHeadersFromConfig(cfg);
  const metaRequired = [
    ...cfg.meta.timestampHeaders,
    ...cfg.meta.nameHeaders,
  ];

  let errors = 0;
  let warnings = 0;

  console.log('\n=== Member Analysis Sheet Header Audit (v1) ===\n');
  console.log('File:', abs);
  console.log('Columns (non-empty):', sheetHeaders.filter((h) => h).length);
  console.log('Total columns:', sheetHeaders.length);

  console.log('\n--- Header classification ---');
  for (const cat of [
    HEADER_CATEGORY.META,
    HEADER_CATEGORY.CONTEXTUAL,
    HEADER_CATEGORY.SCORING,
    HEADER_CATEGORY.OBSOLETE_SCORING_EXCLUDED,
    HEADER_CATEGORY.LEGACY_IGNORED,
    HEADER_CATEGORY.SYNC,
    HEADER_CATEGORY.UNKNOWN,
  ]) {
    const label = CATEGORY_LABELS[cat];
    const n = counts[cat] || 0;
    console.log(`  ${label}: ${n}`);
    if (cat === HEADER_CATEGORY.UNKNOWN && n > 0) {
      unknown.forEach((h) => console.warn(`    ! unknown: ${h}`));
      warnings += n;
    }
  }

  console.log('\n--- Required meta headers ---');
  for (const h of metaRequired) {
    if (findInSheet(sheetHeaders, h)) {
      console.log(`  ✓ ${h}`);
    } else {
      console.error(`  ✗ missing: ${h}`);
      errors += 1;
    }
  }

  console.log('\n--- Required scoring headers ---');
  const missingScoring = requiredScoring.filter((h) => !findInSheet(sheetHeaders, h));
  if (missingScoring.length) {
    errors += missingScoring.length;
    missingScoring.forEach((h) => console.error(`  ✗ missing: ${h}`));
  } else {
    console.log(`  ✓ all ${requiredScoring.length} scoring headers found`);
  }

  console.log('\n--- Contextual headers (raw-only, not scored) ---');
  const missingContextual = (cfg.contextualHeaders || []).filter((h) => !findInSheet(sheetHeaders, h));
  if (missingContextual.length) {
    warnings += missingContextual.length;
    missingContextual.forEach((h) => console.warn(`  ! missing contextual: ${h}`));
  } else {
    console.log(`  ✓ all ${cfg.contextualHeaders.length} contextual headers found`);
  }

  console.log('\n--- Obsolete scoring-excluded (in raw/hash, not scored) ---');
  for (const h of cfg.scoreExcludeHeaders || []) {
    const inSheet = findInSheet(sheetHeaders, h);
    const inScoring = requiredScoring.some((s) => normalizeHeaderKey(s) === normalizeHeaderKey(h));
    if (inScoring) {
      console.error(`  ✗ obsolete header still in scoring config: ${h}`);
      errors += 1;
    } else if (inSheet) {
      console.log(`  ✓ in sheet: ${h}`);
    } else {
      console.log(`  · not in sheet (ok): ${h}`);
    }
  }

  console.log('\n--- Legacy ignored (excluded from raw/hash/scoring) ---');
  for (const h of cfg.rawExcludeHeaders || []) {
    if (findInSheet(sheetHeaders, h)) {
      console.log(`  ✓ in sheet, ignored: ${h}`);
    } else {
      console.log(`  · not in sheet (ok): ${h}`);
    }
  }

  console.log('\n--- Sync columns (optional until GAS adds) ---');
  (cfg.syncColumnHeaders || []).forEach((c) => {
    const present = findInSheet(sheetHeaders, c);
    console.log(present ? `  [present] ${c}` : `  [not yet] ${c}`);
    if (!present && byCategory[HEADER_CATEGORY.SYNC].length === 0) {
      // not an error
    }
  });

  console.log('\n--- Duplicate header names in sheet ---');
  const seen = new Map();
  sheetHeaders.forEach((h, i) => {
    if (!h) return;
    const k = normalizeHeaderKey(h);
    if (seen.has(k)) {
      console.warn(`  ! duplicate "${h}" cols ${seen.get(k) + 1}, ${i + 1}`);
      warnings += 1;
    } else seen.set(k, i);
  });

  console.log('\n--- Summary ---');
  console.log(`  unknown_headers: ${unknown.length}`);
  if (errors) {
    console.error(`FAIL: ${errors} error(s), ${warnings} warning(s)\n`);
    process.exit(1);
  }
  if (unknown.length) {
    console.warn(`PASS with warnings: ${warnings} warning(s) — review unknown_headers\n`);
    process.exit(0);
  }
  console.log(`PASS: all headers classified, unknown=0 (${warnings} other warning(s))\n`);
}

main();
