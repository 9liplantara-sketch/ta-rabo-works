/**
 * 2026 v3 恒久 item_id マスター — CSV 解析・監査・JS 定義との照合
 *
 * 正本 CSV: test/fixtures/member-analysis-v3-item-master.csv
 * Runtime: lib/member-analysis-questionnaire-v3.js
 */

export const ITEM_MASTER_CSV_COLUMNS = [
  'item_id',
  'question_version',
  'scope',
  'instrument',
  'instrument_version',
  'dimension',
  'reverse_scored',
  'response_type',
  'scale_min',
  'scale_max',
  'scoring_included',
  'description',
];

export const ALLOWED_SCOPES = new Set([
  'ack',
  'admin',
  'intake',
  'longitudinal_core',
]);

export const EXPECTED_B5_REVERSE_IDS = new Set([
  'B5-E3R',
  'B5-E4R',
  'B5-C3R',
  'B5-C4R',
  'B5-A3R',
  'B5-A4R',
  'B5-N3R',
  'B5-N4R',
  'B5-O3R',
  'B5-O4R',
]);

export const INSTRUMENT_SCALE_DEFAULTS = {
  lab_big5: { min: 1, max: 7 },
  lab_values: { min: 1, max: 6 },
  lab_regulatory_focus: { min: 1, max: 5 },
  lab_riasec: { min: 1, max: 5 },
};

export const INSTRUMENT_DIMENSION_COUNTS = {
  lab_big5: {
    extraversion: 4,
    conscientiousness: 4,
    agreeableness: 4,
    negative_emotionality: 4,
    openness: 4,
  },
  lab_values: {
    self_direction: 2,
    stimulation: 2,
    hedonism: 2,
    achievement: 2,
    power: 2,
    security: 2,
    conformity: 2,
    tradition: 2,
    benevolence: 2,
    universalism: 2,
  },
  lab_regulatory_focus: {
    promotion: 5,
    prevention: 5,
  },
  lab_riasec: {
    realistic: 4,
    investigative: 4,
    artistic: 4,
    social: 4,
    enterprising: 4,
    conventional: 4,
  },
};

/** @param {string} line */
export function parseCsvLine(line) {
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

/** @param {string} text */
export function parseItemMasterCsv(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) throw new Error('empty csv');

  const header = parseCsvLine(lines[0]).map((h) => h.trim());
  const missing = ITEM_MASTER_CSV_COLUMNS.filter((col) => !header.includes(col));
  if (missing.length) {
    throw new Error(`missing columns: ${missing.join(', ')}`);
  }

  const indexes = Object.fromEntries(header.map((h, i) => [h, i]));
  const rows = [];

  for (let li = 1; li < lines.length; li++) {
    const cells = parseCsvLine(lines[li]);
    if (cells.every((c) => !String(c || '').trim())) continue;

    const row = {};
    for (const col of ITEM_MASTER_CSV_COLUMNS) {
      row[col] = String(cells[indexes[col]] ?? '').trim();
    }
    rows.push(normalizeItemMasterRow(row));
  }

  return rows;
}

/** @param {Record<string, string>} row */
export function normalizeItemMasterRow(row) {
  const scoringIncluded = parseBool(row.scoring_included);
  const reverseScored = parseBool(row.reverse_scored);
  const scaleMin = row.scale_min === '' ? null : Number(row.scale_min);
  const scaleMax = row.scale_max === '' ? null : Number(row.scale_max);

  return {
    item_id: row.item_id,
    question_version: row.question_version,
    scope: row.scope,
    instrument: row.instrument || null,
    instrument_version: row.instrument_version || null,
    dimension: row.dimension || null,
    reverse_scored: reverseScored,
    response_type: row.response_type,
    scale_min: Number.isFinite(scaleMin) ? scaleMin : null,
    scale_max: Number.isFinite(scaleMax) ? scaleMax : null,
    scoring_included: scoringIncluded,
    description: row.description || '',
  };
}

function parseBool(value) {
  const v = String(value ?? '').trim().toLowerCase();
  if (v === 'true' || v === '1' || v === 'yes') return true;
  if (v === 'false' || v === '0' || v === 'no' || v === '') return false;
  return null;
}

/** @param {ReturnType<typeof normalizeItemMasterRow>} row */
export function itemMasterRowToDefinition(row) {
  return {
    id: row.item_id,
    questionVersion: row.question_version,
    scope: row.scope,
    instrument: row.instrument,
    instrumentVersion: row.instrument_version,
    dimension: row.dimension,
    reverseScored: row.reverse_scored,
    responseType: row.response_type,
    scaleMin: row.scale_min,
    scaleMax: row.scale_max,
    scoringIncluded: row.scoring_included,
    aiEligible: inferAiEligible(row),
    description: row.description,
  };
}

function inferAiEligible(row) {
  if (row.scoring_included) return false;
  if (row.response_type === 'text' || row.response_type === 'paragraph') return true;
  if (row.scope === 'intake' || row.scope === 'longitudinal_core') {
    return row.response_type !== 'scale' && row.response_type !== 'grid';
  }
  return false;
}

/**
 * @param {ReturnType<typeof normalizeItemMasterRow>[]} rows
 */
export function auditItemMasterRows(rows) {
  const errors = [];
  const warnings = [];
  const stats = {
    total: rows.length,
    scoringIncluded: 0,
    byInstrument: {},
    byDimension: {},
    byScope: {},
    reverseTrue: [],
  };

  const seenIds = new Map();

  for (const row of rows) {
    if (!row.item_id) {
      errors.push('empty item_id');
      continue;
    }
    if (seenIds.has(row.item_id)) {
      errors.push(`duplicate item_id: ${row.item_id}`);
    } else {
      seenIds.set(row.item_id, true);
    }

    if (row.question_version !== '2026_v1') {
      errors.push(`${row.item_id}: question_version must be 2026_v1 (got ${row.question_version || 'empty'})`);
    }

    if (!ALLOWED_SCOPES.has(row.scope)) {
      errors.push(`${row.item_id}: invalid scope "${row.scope}"`);
    }

    stats.byScope[row.scope] = (stats.byScope[row.scope] || 0) + 1;

    if (row.scoring_included) {
      stats.scoringIncluded += 1;
      if (!row.instrument) errors.push(`${row.item_id}: scoring_included but instrument empty`);
      if (!row.dimension) errors.push(`${row.item_id}: scoring_included but dimension empty`);
    } else if (row.instrument || row.dimension) {
      warnings.push(`${row.item_id}: not scoring_included but has instrument/dimension`);
    }

    if (row.instrument) {
      stats.byInstrument[row.instrument] = (stats.byInstrument[row.instrument] || 0) + 1;
    }
    if (row.dimension) {
      const key = `${row.instrument || '?'}::${row.dimension}`;
      stats.byDimension[key] = (stats.byDimension[key] || 0) + 1;
    }

    if (row.reverse_scored === true) stats.reverseTrue.push(row.item_id);
    if (row.reverse_scored === null) {
      errors.push(`${row.item_id}: invalid reverse_scored value`);
    }

    if (row.scoring_included && row.instrument) {
      const defaults = INSTRUMENT_SCALE_DEFAULTS[row.instrument];
      if (!defaults) {
        errors.push(`${row.item_id}: unknown instrument ${row.instrument}`);
      } else {
        if (row.scale_min !== defaults.min || row.scale_max !== defaults.max) {
          errors.push(
            `${row.item_id}: scale range expected ${defaults.min}-${defaults.max}, got ${row.scale_min}-${row.scale_max}`,
          );
        }
      }
    }

    if (row.item_id === 'VSNAP-01' && row.scoring_included) {
      errors.push('VSNAP-01 must not be scoring_included');
    }
  }

  // instrument totals
  const expectedInstrumentTotals = {
    lab_big5: 20,
    lab_values: 20,
    lab_regulatory_focus: 10,
    lab_riasec: 24,
  };
  for (const [instrument, expected] of Object.entries(expectedInstrumentTotals)) {
    const actual = stats.byInstrument[instrument] || 0;
    if (actual !== expected) {
      errors.push(`instrument ${instrument}: expected ${expected} scoring rows, got ${actual}`);
    }
  }

  // dimension counts per instrument
  for (const [instrument, dims] of Object.entries(INSTRUMENT_DIMENSION_COUNTS)) {
    for (const [dimension, expected] of Object.entries(dims)) {
      const key = `${instrument}::${dimension}`;
      const scoringRows = rows.filter(
        (r) => r.scoring_included && r.instrument === instrument && r.dimension === dimension,
      );
      if (scoringRows.length !== expected) {
        errors.push(`${instrument}.${dimension}: expected ${expected} items, got ${scoringRows.length}`);
      }
    }
  }

  // reverse_scored
  const reverseSet = new Set(stats.reverseTrue);
  for (const id of EXPECTED_B5_REVERSE_IDS) {
    if (!reverseSet.has(id)) errors.push(`missing reverse_scored TRUE: ${id}`);
  }
  for (const id of stats.reverseTrue) {
    if (!EXPECTED_B5_REVERSE_IDS.has(id)) {
      errors.push(`unexpected reverse_scored TRUE: ${id}`);
    }
  }
  if (stats.reverseTrue.length !== 10) {
    errors.push(`reverse_scored TRUE count: expected 10, got ${stats.reverseTrue.length}`);
  }

  // totals
  if (rows.length !== 118) errors.push(`item_id total: expected 118, got ${rows.length}`);
  if (stats.scoringIncluded !== 74) {
    errors.push(`scoring_included total: expected 74, got ${stats.scoringIncluded}`);
  }

  // non-scoring must not appear in scoring-only instruments incorrectly
  const nonScoringWithScale = rows.filter(
    (r) => !r.scoring_included && r.scale_min != null && r.instrument,
  );
  for (const row of nonScoringWithScale) {
    warnings.push(`${row.item_id}: non-scoring but has instrument scale metadata`);
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    stats,
  };
}

/** Flat definition row for CSV ↔ JS comparison */
export function flattenItemDefinition(item) {
  return {
    item_id: item.id,
    question_version: item.questionVersion,
    scope: item.scope,
    instrument: item.instrument || '',
    instrument_version: item.instrumentVersion || '',
    dimension: item.dimension || '',
    reverse_scored: item.reverseScored ? 'TRUE' : 'FALSE',
    response_type: item.responseType,
    scale_min: item.scaleMin == null ? '' : String(item.scaleMin),
    scale_max: item.scaleMax == null ? '' : String(item.scaleMax),
    scoring_included: item.scoringIncluded ? 'TRUE' : 'FALSE',
    description: item.description || '',
  };
}

/** @param {ReturnType<typeof normalizeItemMasterRow>[]} csvRows @param {object[]} jsItems */
export function diffItemMasterCsvAndJs(csvRows, jsItems) {
  const diffs = [];
  const csvById = new Map(csvRows.map((r) => [r.item_id, r]));
  const jsById = new Map(jsItems.map((i) => [i.id, i]));

  for (const id of csvById.keys()) {
    if (!jsById.has(id)) diffs.push({ kind: 'missing_in_js', item_id: id });
  }
  for (const id of jsById.keys()) {
    if (!csvById.has(id)) diffs.push({ kind: 'missing_in_csv', item_id: id });
  }

  for (const [id, csvRow] of csvById) {
    const jsItem = jsById.get(id);
    if (!jsItem) continue;
    const flat = flattenItemDefinition(jsItem);
    for (const col of ITEM_MASTER_CSV_COLUMNS) {
      let csvVal;
      if (col === 'reverse_scored') {
        csvVal = csvRow.reverse_scored ? 'TRUE' : 'FALSE';
      } else if (col === 'scoring_included') {
        csvVal = csvRow.scoring_included ? 'TRUE' : 'FALSE';
      } else {
        csvVal = String(csvRow[col] ?? '');
      }
      const jsVal = String(flat[col] ?? '');
      if (csvVal !== jsVal) {
        diffs.push({ kind: 'field_mismatch', item_id: id, field: col, csv: csvVal, js: jsVal });
      }
    }
  }

  return diffs;
}
