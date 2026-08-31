/**
 * 監査済み Proposal → Mapping Sheet metadata 反映（Node / 監査用）
 */

import {
  EXPECTED_B5_REVERSE_IDS,
  parseItemMasterCsv,
} from './member-analysis-v3-item-master.js';
import {
  MAPPING_CSV_COLUMNS,
  mappingRowKey,
  normalizeMappingRow,
  parseCsvText,
  parseGoogleFormMappingCsv,
} from './member-analysis-v3-form-mapping.js';

export const METADATA_APPLY_FIELDS = [
  'item_id',
  'question_version',
  'scope',
  'instrument',
  'dimension',
  'reverse_scored',
];

const INSTRUMENT_COUNTS = {
  lab_big5: 20,
  lab_values: 20,
  lab_regulatory_focus: 10,
  lab_riasec: 24,
};

/** @param {Record<string, string>} proposalRow */
export function proposalToMetadata(proposalRow) {
  return {
    item_id: proposalRow.proposed_item_id || proposalRow.item_id || '',
    question_version: proposalRow.question_version || '',
    scope: proposalRow.scope || '',
    instrument: proposalRow.instrument || '',
    dimension: proposalRow.dimension || '',
    reverse_scored: normalizeReverseScored(proposalRow.reverse_scored),
  };
}

function normalizeReverseScored(value) {
  const v = String(value ?? '').trim().toUpperCase();
  if (v === 'TRUE' || v === '1') return 'TRUE';
  if (v === 'FALSE' || v === '0' || v === '') return 'FALSE';
  return v;
}

/**
 * @param {ReturnType<typeof normalizeMappingRow>[]} mappingRows
 * @param {Record<string, string>[]} proposalRows
 */
export function buildFinalMappingRows(mappingRows, proposalRows) {
  const proposalByKey = new Map();
  for (const row of proposalRows) {
    const key = mappingRowKey({
      google_item_id: row.google_item_id,
      row_index: row.row_index === undefined ? '' : String(row.row_index),
    });
    proposalByKey.set(key, row);
  }

  return mappingRows.map((row) => {
    const out = { ...row };
    if (String(row.active || '').toUpperCase() !== 'TRUE') {
      for (const field of METADATA_APPLY_FIELDS) {
        out[field] = '';
      }
      return out;
    }

    const key = mappingRowKey(row);
    const proposal = proposalByKey.get(key);
    if (!proposal) {
      throw new Error(`no proposal for active mapping key: ${key}`);
    }

    const meta = proposalToMetadata(proposal);
    for (const field of METADATA_APPLY_FIELDS) {
      out[field] = meta[field];
    }
    return out;
  });
}

/**
 * @param {ReturnType<typeof buildFinalMappingRows>} finalRows
 * @param {ReturnType<typeof parseItemMasterCsv>} masterRows
 */
export function auditFinalMappingRows(finalRows, masterRows) {
  const errors = [];
  const warnings = [];
  const active = finalRows.filter((r) => String(r.active || '').toUpperCase() === 'TRUE');
  const inactive = finalRows.filter((r) => String(r.active || '').toUpperCase() !== 'TRUE');

  const keyCounts = new Map();
  const itemIdCounts = new Map();
  for (const row of finalRows) {
    const key = mappingRowKey(row);
    keyCounts.set(key, (keyCounts.get(key) || 0) + 1);
    if (String(row.active || '').toUpperCase() === 'TRUE') {
      const id = String(row.item_id || '').trim();
      itemIdCounts.set(id, (itemIdCounts.get(id) || 0) + 1);
    }
  }

  if (finalRows.length !== 130) errors.push(`total rows: expected 130, got ${finalRows.length}`);
  if (active.length !== 118) errors.push(`active rows: expected 118, got ${active.length}`);
  if (inactive.length !== 12) errors.push(`inactive rows: expected 12, got ${inactive.length}`);

  const activeWithItemId = active.filter((r) => String(r.item_id || '').trim());
  if (activeWithItemId.length !== 118) {
    errors.push(`active item_id non-empty: expected 118, got ${activeWithItemId.length}`);
  }

  const inactiveWithItemId = inactive.filter((r) => String(r.item_id || '').trim());
  if (inactiveWithItemId.length !== 0) {
    errors.push(`inactive item_id non-empty: expected 0, got ${inactiveWithItemId.length}`);
  }

  const dupKeys = [...keyCounts.entries()].filter(([, n]) => n > 1);
  if (dupKeys.length) errors.push(`duplicate google_item_id+row_index: ${dupKeys.length}`);

  const dupItemIds = [...itemIdCounts.entries()].filter(([, n]) => n > 1);
  if (dupItemIds.length) errors.push(`duplicate item_id: ${dupItemIds.map(([id]) => id).join(', ')}`);

  if (new Set(active.map((r) => r.item_id)).size !== 118) {
    errors.push(`active unique item_id: expected 118, got ${new Set(active.map((r) => r.item_id)).size}`);
  }

  const qvBad = active.filter((r) => r.question_version !== '2026_v1');
  if (qvBad.length) errors.push(`question_version != 2026_v1: ${qvBad.length} rows`);

  const scopeDist = {};
  for (const row of active) {
    scopeDist[row.scope] = (scopeDist[row.scope] || 0) + 1;
  }

  const instrumentDist = {};
  for (const row of active) {
    const inst = row.instrument || '(empty)';
    instrumentDist[inst] = (instrumentDist[inst] || 0) + 1;
  }

  for (const [inst, expected] of Object.entries(INSTRUMENT_COUNTS)) {
    const actual = active.filter((r) => r.instrument === inst).length;
    if (actual !== expected) errors.push(`instrument ${inst}: expected ${expected}, got ${actual}`);
  }

  const reverseTrue = active.filter((r) => String(r.reverse_scored || '').toUpperCase() === 'TRUE');
  if (reverseTrue.length !== 10) {
    errors.push(`reverse_scored TRUE: expected 10, got ${reverseTrue.length}`);
  }

  const reverseIds = new Set(reverseTrue.map((r) => r.item_id));
  for (const id of EXPECTED_B5_REVERSE_IDS) {
    if (!reverseIds.has(id)) errors.push(`missing reverse_scored TRUE: ${id}`);
  }
  for (const row of reverseTrue) {
    if (!EXPECTED_B5_REVERSE_IDS.has(row.item_id)) {
      errors.push(`unexpected reverse_scored TRUE: ${row.item_id}`);
    }
  }

  const masterById = new Map(masterRows.map((r) => [r.item_id, r]));
  const metadataDiffs = [];
  for (const row of active) {
    const master = masterById.get(row.item_id);
    if (!master) {
      metadataDiffs.push({ item_id: row.item_id, field: 'item_id', final: row.item_id, master: '(missing)' });
      continue;
    }
    const checks = [
      ['question_version', row.question_version, master.question_version],
      ['scope', row.scope, master.scope],
      ['instrument', row.instrument || '', master.instrument || ''],
      ['dimension', row.dimension || '', master.dimension || ''],
      ['reverse_scored', row.reverse_scored, master.reverse_scored ? 'TRUE' : 'FALSE'],
    ];
    for (const [field, finalVal, masterVal] of checks) {
      if (String(finalVal) !== String(masterVal)) {
        metadataDiffs.push({ item_id: row.item_id, field, final: finalVal, master: masterVal });
      }
    }
  }

  if (metadataDiffs.length) {
    errors.push(`metadata diff vs master: ${metadataDiffs.length} field(s)`);
  }

  const masterScopeDist = {};
  for (const row of masterRows) {
    masterScopeDist[row.scope] = (masterScopeDist[row.scope] || 0) + 1;
  }
  for (const [scope, count] of Object.entries(masterScopeDist)) {
    if ((scopeDist[scope] || 0) !== count) {
      errors.push(`scope ${scope}: master=${count}, final=${scopeDist[scope] || 0}`);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    stats: {
      total: finalRows.length,
      active: active.length,
      inactive: inactive.length,
      activeItemId: activeWithItemId.length,
      uniqueItemId: new Set(active.map((r) => r.item_id)).size,
      inactiveItemId: inactiveWithItemId.length,
      scopeDist,
      instrumentDist,
      reverseScoredTrue: reverseTrue.length,
      metadataDiffCount: metadataDiffs.length,
    },
    metadataDiffs,
  };
}

/** @param {ReturnType<typeof buildFinalMappingRows>} finalRows */
export function finalMappingRowsToCsv(finalRows) {
  const lines = [MAPPING_CSV_COLUMNS.join(',')];
  for (const row of finalRows) {
    lines.push(MAPPING_CSV_COLUMNS.map((col) => csvEscape(row[col] ?? '')).join(','));
  }
  return `${lines.join('\n')}\n`;
}

function csvEscape(value) {
  const s = String(value ?? '');
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * dry-run diff: current mapping vs final for metadata fields
 * @param {ReturnType<typeof normalizeMappingRow>[]} currentRows
 * @param {ReturnType<typeof buildFinalMappingRows>} finalRows
 */
export function computeMetadataApplyDiff(currentRows, finalRows) {
  const finalByKey = new Map(finalRows.map((r) => [mappingRowKey(r), r]));
  const diffs = [];
  let rowsToUpdate = 0;
  let rowsUnchanged = 0;

  for (const current of currentRows) {
    const final = finalByKey.get(mappingRowKey(current));
    if (!final) continue;

    if (String(current.active || '').toUpperCase() !== 'TRUE') {
      rowsUnchanged += 1;
      continue;
    }

    let changed = false;
    const entry = {
      google_item_id: current.google_item_id,
      row_index: current.row_index,
      changes: [],
    };

    for (const field of METADATA_APPLY_FIELDS) {
      const oldVal = String(current[field] ?? '');
      const newVal = String(final[field] ?? '');
      if (oldVal !== newVal) {
        changed = true;
        entry.changes.push({ field, old: oldVal, new: newVal });
      }
    }

    if (changed) {
      rowsToUpdate += 1;
      diffs.push(entry);
    } else {
      rowsUnchanged += 1;
    }
  }

  return { rowsToUpdate, rowsUnchanged, diffs };
}

/** @param {Record<string, string>[]} proposalRows */
export function proposalRowsToGasMetadataArtifact(proposalRows) {
  const entries = proposalRows.map((row) => ({
    google_item_id: String(row.google_item_id),
    row_index: row.row_index === undefined || row.row_index === null ? '' : String(row.row_index),
    ...proposalToMetadata(row),
  }));

  entries.sort((a, b) => {
    const ka = `${a.google_item_id}\u0001${a.row_index}`;
    const kb = `${b.google_item_id}\u0001${b.row_index}`;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });

  const lines = [
    '/**',
    ' * AUTO-GENERATED — 監査済み Proposal から生成。手編集禁止。',
    ' *',
    ' * 生成:',
    ' *   npm run generate:member-analysis-v3-mapping-metadata-artifact',
    ' *',
    ' * 正本: test/fixtures/member-analysis-v3-item-mapping-proposal.csv',
    ' */',
    '',
    'var MEMBER_ANALYSIS_V3_MAPPING_METADATA = ' + JSON.stringify(entries, null, 2) + ';',
    '',
  ];

  return lines.join('\n');
}

export function loadMappingAndProposal(mappingText, proposalText) {
  const mappingRows = parseGoogleFormMappingCsv(mappingText, { excludeOrphans: false });
  const proposalRows = parseCsvText(proposalText);
  return { mappingRows, proposalRows };
}
