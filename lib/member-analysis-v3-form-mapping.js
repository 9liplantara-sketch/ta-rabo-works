/**
 * 2026 v3 Google Form Mapping CSV ↔ item master 監査・対応候補生成
 *
 * 正本 A: test/fixtures/member-analysis-v3-item-master.csv
 * 正本 B: test/fixtures/member-analysis-v3-google-form-mapping.csv
 */

import { parseItemMasterCsv } from './member-analysis-v3-item-master.js';

/** merge 修正前 export に残る旧 Grid 親行・削除済み item（blank row_index） */
export const MAPPING_ORPHAN_GOOGLE_ITEM_IDS = new Set([
  '322128877',
  '1956668441',
  '18110264',
  '1118596123',
  '2063490072',
]);

export const MAPPING_CSV_COLUMNS = [
  'form_version',
  'google_item_id',
  'row_index',
  'row_label',
  'item_id',
  'question_version',
  'response_type',
  'scope',
  'instrument',
  'dimension',
  'reverse_scored',
  'source_header',
  'active',
];

export const PROPOSAL_CSV_COLUMNS = [
  'form_order',
  'google_item_id',
  'row_index',
  'source_header',
  'row_label',
  'response_type',
  'proposed_item_id',
  'question_version',
  'scope',
  'instrument',
  'instrument_version',
  'dimension',
  'reverse_scored',
  'master_response_type',
  'scale_min',
  'scale_max',
  'scoring_included',
  'description',
  'match_method',
  'match_confidence',
  'match_notes',
  'review_status',
];

const FORM_TO_MASTER_RESPONSE = {
  multi_choice: 'checkbox',
  checkbox: 'checkbox',
  grid: 'grid_scale',
  GRID: 'grid_scale',
  CHECKBOX_GRID: 'grid_scale',
  paragraph: 'paragraph',
  PARAGRAPH_TEXT: 'paragraph',
  scale: 'scale',
  text: 'text',
  dropdown: 'dropdown',
};

const INSTRUMENT_GRID_COUNTS = {
  lab_big5: 20,
  lab_values: 20,
  lab_regulatory_focus: 10,
  lab_riasec: 24,
};

/** @param {string} text */
export function normalizeMappingText(text) {
  let s = String(text ?? '').trim();
  s = s.replace(/[\u3000\s]+/g, ' ');
  s = s.replace(/^Q?\d+[-.]?\d*[.．、\s]*/i, '');
  s = s.replace(/^\d+[.．]\s*/, '');
  s = s.replace(/[。．.?？!！]+$/g, '');
  return s;
}

/** @param {string} text @returns {string[][]} */
export function parseCsvRecords(text) {
  const rows = [];
  let row = [];
  let cur = '';
  let inQuotes = false;
  const src = text.replace(/^\uFEFF/, '');

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(cur);
      cur = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      row.push(cur);
      cur = '';
      if (row.some((cell) => String(cell || '').trim())) {
        rows.push(row);
      }
      row = [];
    } else {
      cur += ch;
    }
  }

  if (cur.length || row.length) {
    row.push(cur);
    if (row.some((cell) => String(cell || '').trim())) {
      rows.push(row);
    }
  }

  return rows;
}

/** @param {string} text */
export function parseCsvText(text) {
  const records = parseCsvRecords(text);
  if (!records.length) throw new Error('empty csv');
  const header = records[0].map((h) => h.trim());
  const rows = [];
  for (let li = 1; li < records.length; li++) {
    const cells = records[li];
    const row = {};
    for (let ci = 0; ci < header.length; ci++) {
      row[header[ci]] = String(cells[ci] ?? '').trim();
    }
    rows.push(row);
  }
  return rows;
}

/**
 * @param {string} text
 * @param {{ excludeOrphans?: boolean }} [opts]
 */
export function parseGoogleFormMappingCsv(text, opts = {}) {
  const { excludeOrphans = true } = opts;
  const rows = parseCsvText(text);
  const missing = MAPPING_CSV_COLUMNS.filter((col) => !(col in (rows[0] || {})));
  if (missing.length) {
    throw new Error(`mapping csv missing columns: ${missing.join(', ')}`);
  }

  return rows
    .map(normalizeMappingRow)
    .filter((row) => {
      if (!excludeOrphans) return true;
      return !(
        MAPPING_ORPHAN_GOOGLE_ITEM_IDS.has(row.google_item_id)
        && row.row_index === ''
      );
    });
}

/** @param {Record<string, string>} row */
export function normalizeMappingRow(row) {
  return {
    form_version: row.form_version || '',
    google_item_id: row.google_item_id || '',
    row_index: row.row_index === '' ? '' : String(row.row_index),
    row_label: row.row_label || '',
    item_id: row.item_id || '',
    question_version: row.question_version || '',
    response_type: row.response_type || '',
    scope: row.scope || '',
    instrument: row.instrument || '',
    dimension: row.dimension || '',
    reverse_scored: row.reverse_scored || '',
    source_header: row.source_header || '',
    active: String(row.active || '').trim().toUpperCase(),
  };
}

export function isActiveMappingRow(row) {
  return row.active === 'TRUE';
}

export function mappingRowKey(row) {
  return `${row.google_item_id}\u0001${row.row_index}`;
}

/** @param {ReturnType<typeof normalizeMappingRow>[]} activeRows */
export function segmentActiveMappingRows(activeRows) {
  const segments = [];
  let i = 0;
  while (i < activeRows.length) {
    const row = activeRows[i];
    if (row.row_index !== '') {
      const googleItemId = row.google_item_id;
      const gridRows = [];
      while (
        i < activeRows.length
        && activeRows[i].google_item_id === googleItemId
        && activeRows[i].row_index !== ''
      ) {
        gridRows.push(activeRows[i]);
        i += 1;
      }
      segments.push({ kind: 'grid', googleItemId, rows: gridRows });
    } else {
      segments.push({ kind: 'single', row });
      i += 1;
    }
  }
  return segments;
}

/** @param {ReturnType<typeof parseItemMasterCsv>} masterRows */
export function segmentMasterRows(masterRows) {
  const segments = [];
  let i = 0;
  while (i < masterRows.length) {
    const row = masterRows[i];
    if (row.response_type === 'grid_scale' && row.instrument) {
      const instrument = row.instrument;
      const gridRows = [];
      while (
        i < masterRows.length
        && masterRows[i].response_type === 'grid_scale'
        && masterRows[i].instrument === instrument
      ) {
        gridRows.push(masterRows[i]);
        i += 1;
      }
      segments.push({ kind: 'grid', instrument, rows: gridRows });
    } else {
      segments.push({ kind: 'single', row });
      i += 1;
    }
  }
  return segments;
}

function expectedMasterResponse(formResponseType) {
  return FORM_TO_MASTER_RESPONSE[formResponseType] || formResponseType.toLowerCase();
}

function responseTypesCompatible(formType, masterType) {
  const expected = expectedMasterResponse(formType);
  return expected === masterType;
}

/**
 * @param {ReturnType<typeof normalizeMappingRow>[]} mappingRows
 * @param {ReturnType<typeof parseItemMasterCsv>} masterRows
 */
export function auditMappingStructure(mappingRows, masterRows) {
  const errors = [];
  const warnings = [];
  const activeRows = mappingRows.filter(isActiveMappingRow);
  const inactiveRows = mappingRows.filter((r) => !isActiveMappingRow(r));

  const keyCounts = new Map();
  for (const row of mappingRows) {
    const key = mappingRowKey(row);
    keyCounts.set(key, (keyCounts.get(key) || 0) + 1);
  }
  const duplicateKeys = [...keyCounts.entries()].filter(([, n]) => n > 1);

  const gridGroups = new Map();
  for (const row of activeRows) {
    if (row.row_index === '') continue;
    const list = gridGroups.get(row.google_item_id) || [];
    list.push(Number(row.row_index));
    gridGroups.set(row.google_item_id, list);
  }

  const gridLogicalRows = [...gridGroups.values()].reduce((sum, idxs) => sum + idxs.length, 0);

  if (masterRows.length !== 118) errors.push(`master total: expected 118, got ${masterRows.length}`);
  if (activeRows.length !== 118) errors.push(`mapping active: expected 118, got ${activeRows.length}`);
  if (mappingRows.length !== 130) errors.push(`mapping total: expected 130, got ${mappingRows.length}`);
  if (inactiveRows.length !== 12) errors.push(`mapping inactive: expected 12, got ${inactiveRows.length}`);

  const masterScoring = masterRows.filter((r) => r.scoring_included).length;
  if (masterScoring !== 74) errors.push(`master scoring: expected 74, got ${masterScoring}`);
  if (gridLogicalRows !== 74) errors.push(`mapping grid logical rows: expected 74, got ${gridLogicalRows}`);

  for (const [instrument, expected] of Object.entries(INSTRUMENT_GRID_COUNTS)) {
    const masterCount = masterRows.filter((r) => r.instrument === instrument).length;
    if (masterCount !== expected) {
      errors.push(`${instrument} master: expected ${expected}, got ${masterCount}`);
    }
  }

  for (const [googleItemId, idxs] of gridGroups) {
    idxs.sort((a, b) => a - b);
    for (let n = 0; n < idxs.length; n++) {
      if (idxs[n] !== n) {
        errors.push(`grid ${googleItemId}: row_index not 0-based consecutive (missing ${n})`);
        break;
      }
    }
  }

  if (duplicateKeys.length) {
    errors.push(`duplicate google_item_id+row_index: ${duplicateKeys.length}`);
  }

  const emptyActiveText = activeRows.filter(
    (r) => !r.source_header.trim() && !r.row_label.trim(),
  );
  if (emptyActiveText.length) {
    errors.push(`active rows with empty source_header and row_label: ${emptyActiveText.length}`);
  }

  const masterIds = masterRows.map((r) => r.item_id);
  if (new Set(masterIds).size !== masterIds.length) {
    errors.push('duplicate master item_id');
  }

  const responseTypeDist = {};
  for (const row of activeRows) {
    responseTypeDist[row.response_type] = (responseTypeDist[row.response_type] || 0) + 1;
  }

  const mapSegments = segmentActiveMappingRows(activeRows);
  const masterSegments = segmentMasterRows(masterRows);
  if (mapSegments.length !== masterSegments.length) {
    errors.push(`segment count mismatch: form ${mapSegments.length}, master ${masterSegments.length}`);
  } else {
    for (let i = 0; i < mapSegments.length; i++) {
      const ms = mapSegments[i];
      const xs = masterSegments[i];
      if (ms.kind !== xs.kind) {
        errors.push(`segment ${i} kind mismatch: form ${ms.kind}, master ${xs.kind}`);
      } else if (ms.kind === 'grid' && ms.rows.length !== xs.rows.length) {
        errors.push(
          `segment ${i} grid length mismatch: form ${ms.rows.length}, master ${xs.rows.length} (${xs.instrument})`,
        );
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    stats: {
      mappingTotal: mappingRows.length,
      mappingActive: activeRows.length,
      mappingInactive: inactiveRows.length,
      masterTotal: masterRows.length,
      masterScoring,
      gridLogicalRows,
      gridItemCount: gridGroups.size,
      responseTypeDist,
      segmentCount: mapSegments.length,
    },
  };
}

/**
 * @param {ReturnType<typeof normalizeMappingRow>} formRow
 * @param {ReturnType<typeof parseItemMasterCsv>[number]} masterRow
 * @param {{ exactText: boolean, orderOnly: boolean, gridPrefixStripped?: boolean, responseTypeOk: boolean }} ctx
 */
function buildProposalRow(formRow, masterRow, formOrder, ctx) {
  const formText = formRow.row_index !== ''
    ? formRow.row_label
    : formRow.source_header;
  const notes = [];

  if (ctx.gridPrefixStripped) {
    notes.push('Grid row_label: 番号prefix除去後に master description と一致');
  }
  if (!ctx.responseTypeOk) {
    notes.push(
      `response_type: form=${formRow.response_type}, master=${masterRow.response_type}`,
    );
  }
  if (ctx.orderOnly && !ctx.exactText) {
    notes.push('Form順序とmaster順序の構造的位置一致（文言は非完全一致）');
  }
  if (ctx.exactText && formRow.row_index === '') {
    notes.push('normalized source_header === master description');
  }

  let reviewStatus = 'NEEDS_REVIEW';
  let matchMethod = 'ORDER_STRUCTURAL';
  let matchConfidence = '50';

  if (ctx.exactText && ctx.responseTypeOk) {
    reviewStatus = 'AUTO_EXACT';
    matchMethod = formRow.row_index !== '' ? 'GRID_TEXT_EXACT' : 'TEXT_EXACT';
    matchConfidence = '100';
  } else if (ctx.exactText && !ctx.responseTypeOk) {
    reviewStatus = 'NEEDS_REVIEW';
    matchMethod = 'TEXT_EXACT_RESPONSE_MISMATCH';
    matchConfidence = '80';
  } else if (formRow.row_index !== '' && ctx.orderOnly) {
    reviewStatus = 'NEEDS_REVIEW';
    matchMethod = 'GRID_ORDER_STRUCTURAL';
    matchConfidence = '70';
  } else if (ctx.orderOnly) {
    reviewStatus = 'NEEDS_REVIEW';
    matchMethod = 'ORDER_STRUCTURAL';
    matchConfidence = '50';
  } else {
    reviewStatus = 'UNMATCHED';
    matchMethod = 'NONE';
    matchConfidence = '0';
  }

  return {
    form_order: String(formOrder),
    google_item_id: formRow.google_item_id,
    row_index: formRow.row_index,
    source_header: formRow.source_header,
    row_label: formRow.row_label,
    response_type: formRow.response_type,
    proposed_item_id: masterRow.item_id,
    question_version: masterRow.question_version,
    scope: masterRow.scope,
    instrument: masterRow.instrument || '',
    instrument_version: masterRow.instrument_version || '',
    dimension: masterRow.dimension || '',
    reverse_scored: masterRow.reverse_scored ? 'TRUE' : 'FALSE',
    master_response_type: masterRow.response_type,
    scale_min: masterRow.scale_min == null ? '' : String(masterRow.scale_min),
    scale_max: masterRow.scale_max == null ? '' : String(masterRow.scale_max),
    scoring_included: masterRow.scoring_included ? 'TRUE' : 'FALSE',
    description: masterRow.description,
    match_method: matchMethod,
    match_confidence: matchConfidence,
    match_notes: notes.join('; '),
    review_status: reviewStatus,
    _formText: formText,
    _masterText: masterRow.description,
  };
}

/**
 * @param {ReturnType<typeof normalizeMappingRow>[]} mappingRows
 * @param {ReturnType<typeof parseItemMasterCsv>} masterRows
 */
export function proposeFormItemMappings(mappingRows, masterRows) {
  const structure = auditMappingStructure(mappingRows, masterRows);
  if (!structure.ok) {
    return { ok: false, structure, proposals: [], audit: null };
  }

  const activeRows = mappingRows.filter(isActiveMappingRow);
  const mapSegments = segmentActiveMappingRows(activeRows);
  const masterSegments = segmentMasterRows(masterRows);
  const proposals = [];
  let formOrder = 0;

  for (let si = 0; si < mapSegments.length; si++) {
    const ms = mapSegments[si];
    const xs = masterSegments[si];

    if (ms.kind === 'grid') {
      for (let ri = 0; ri < ms.rows.length; ri++) {
        formOrder += 1;
        const formRow = ms.rows[ri];
        const masterRow = xs.rows[ri];
        const exactText = normalizeMappingText(formRow.row_label)
          === normalizeMappingText(masterRow.description);
        const gridPrefixStripped = exactText && /^\d+[.．]\s/.test(formRow.row_label);
        const responseTypeOk = responseTypesCompatible(formRow.response_type, masterRow.response_type);

        proposals.push(
          buildProposalRow(formRow, masterRow, formOrder, {
            exactText,
            orderOnly: !exactText,
            gridPrefixStripped,
            responseTypeOk,
          }),
        );
      }
    } else {
      formOrder += 1;
      const formRow = ms.row;
      const masterRow = xs.row;
      const exactText = normalizeMappingText(formRow.source_header)
        === normalizeMappingText(masterRow.description);
      const responseTypeOk = responseTypesCompatible(formRow.response_type, masterRow.response_type);

      proposals.push(
        buildProposalRow(formRow, masterRow, formOrder, {
          exactText,
          orderOnly: !exactText,
          responseTypeOk,
        }),
      );
    }
  }

  const audit = auditProposals(proposals, masterRows, activeRows);
  return { ok: audit.ok, structure, proposals, audit };
}

/** @param {ReturnType<typeof buildProposalRow>[]} proposals */
export function auditProposals(proposals, masterRows, activeRows) {
  const errors = [];
  const proposedIds = proposals.map((p) => p.proposed_item_id);
  const uniqueIds = new Set(proposedIds);

  if (proposals.length !== 118) errors.push(`proposal rows: expected 118, got ${proposals.length}`);
  if (uniqueIds.size !== 118) errors.push(`unique proposed_item_id: expected 118, got ${uniqueIds.size}`);
  if (activeRows.length !== proposals.length) {
    errors.push(`active mapping vs proposals: ${activeRows.length} vs ${proposals.length}`);
  }

  const masterIdSet = new Set(masterRows.map((r) => r.item_id));
  const unusedMaster = masterRows.filter((r) => !uniqueIds.has(r.item_id));
  const unknownProposed = proposedIds.filter((id) => !masterIdSet.has(id));
  if (unusedMaster.length) errors.push(`unmatched master item_id: ${unusedMaster.length}`);
  if (unknownProposed.length) errors.push(`unknown proposed item_id: ${unknownProposed.join(', ')}`);

  const dupProposed = proposedIds.filter((id, i) => proposedIds.indexOf(id) !== i);
  if (dupProposed.length) errors.push(`duplicate proposed_item_id: ${[...new Set(dupProposed)].join(', ')}`);

  const byInstrument = {
    lab_big5: 0,
    lab_values: 0,
    lab_regulatory_focus: 0,
    lab_riasec: 0,
  };
  for (const p of proposals) {
    if (p.instrument in byInstrument) byInstrument[p.instrument] += 1;
  }
  for (const [inst, expected] of Object.entries(INSTRUMENT_GRID_COUNTS)) {
    if (byInstrument[inst] !== expected) {
      errors.push(`${inst} mapped: expected ${expected}, got ${byInstrument[inst]}`);
    }
  }

  const reviewCounts = {};
  for (const p of proposals) {
    reviewCounts[p.review_status] = (reviewCounts[p.review_status] || 0) + 1;
  }

  const needsReview = proposals.filter((p) => p.review_status === 'NEEDS_REVIEW');
  const autoExact = proposals.filter((p) => p.review_status === 'AUTO_EXACT');

  return {
    ok: errors.length === 0,
    errors,
    stats: {
      proposalRows: proposals.length,
      uniqueItemId: uniqueIds.size,
      autoExact: autoExact.length,
      needsReview: needsReview.length,
      unmatched: reviewCounts.UNMATCHED || 0,
      byInstrument,
      reviewCounts,
    },
    needsReview,
    autoExact,
  };
}

/** @param {ReturnType<typeof buildProposalRow>[]} proposals */
export function proposalsToCsv(proposals) {
  const lines = [PROPOSAL_CSV_COLUMNS.join(',')];
  for (const p of proposals) {
    const row = PROPOSAL_CSV_COLUMNS.map((col) => csvEscape(p[col] ?? ''));
    lines.push(row.join(','));
  }
  return `${lines.join('\n')}\n`;
}

function csvEscape(value) {
  const s = String(value ?? '');
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
