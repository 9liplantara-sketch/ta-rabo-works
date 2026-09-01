/**
 * v3 Form Grid getColumns() 実測 vs canonical label map 監査
 */
import { listV3FormScaleLabels } from './member-analysis-v3-form-scale-choices.js';

/** Phase 1 確定 — Google item ID で識別 */
export const V3_SCALE_GRID_TARGETS = [
  {
    key: 'Big Five',
    googleItemId: '322128877',
    instrument: 'lab_big5',
    expectedRowCount: 20,
    expectedColumnCount: 7,
  },
  {
    key: 'Values',
    googleItemId: '1956668441',
    instrument: 'lab_values',
    expectedRowCount: 20,
    expectedColumnCount: 6,
  },
  {
    key: 'Regulatory Focus',
    googleItemId: '18110264',
    instrument: 'lab_regulatory_focus',
    expectedRowCount: 10,
    expectedColumnCount: 5,
  },
  {
    key: 'RIASEC',
    googleItemId: '1118596123',
    instrument: 'lab_riasec',
    expectedRowCount: 24,
    expectedColumnCount: 5,
  },
];

/**
 * @param {string[]} actual
 * @param {string[]} expected
 */
export function diffStringArraysExact(actual, expected) {
  const diffs = [];
  const maxLen = Math.max(actual.length, expected.length);
  for (let i = 0; i < maxLen; i += 1) {
    const a = actual[i];
    const e = expected[i];
    if (a === e) continue;
    if (a === undefined) {
      diffs.push({ index: i, kind: 'missing_actual', expected: e });
    } else if (e === undefined) {
      diffs.push({ index: i, kind: 'extra_actual', actual: a });
    } else {
      diffs.push({ index: i, kind: 'mismatch', actual: a, expected: e });
    }
  }
  return diffs;
}

/**
 * @param {{ key?: string, google_item_id?: number|string, googleItemId?: string, instrument?: string, row_count?: number, column_count?: number, columns?: string[] }} grid
 * @param {typeof V3_SCALE_GRID_TARGETS[number]} spec
 */
export function compareActualGridToCanonical(grid, spec) {
  const actualColumns = (grid.columns || []).map((c) => String(c));
  const expectedColumns = listV3FormScaleLabels(spec.instrument);
  const columnDiffs = diffStringArraysExact(actualColumns, expectedColumns);
  const actualColumnCount = grid.column_count ?? actualColumns.length;
  const actualRowCount = grid.row_count ?? null;

  return {
    key: spec.key,
    instrument: spec.instrument,
    googleItemId: spec.googleItemId,
    match:
      actualColumnCount === spec.expectedColumnCount
      && actualRowCount === spec.expectedRowCount
      && columnDiffs.length === 0,
    actualColumnCount,
    expectedColumnCount: spec.expectedColumnCount,
    actualRowCount,
    expectedRowCount: spec.expectedRowCount,
    actualColumns,
    expectedColumns,
    columnDiffs,
  };
}

/**
 * @param {{ grids?: Array<{ key?: string, google_item_id?: number|string, instrument?: string, row_count?: number, column_count?: number, columns?: string[] }> }} payload
 */
export function auditFormScaleColumnsPayload(payload) {
  const grids = payload?.grids || [];
  const byId = new Map(
    grids.map((g) => [String(g.google_item_id ?? g.googleItemId ?? ''), g]),
  );
  const byKey = new Map(grids.map((g) => [String(g.key || ''), g]));

  const results = V3_SCALE_GRID_TARGETS.map((spec) => {
    const grid = byId.get(spec.googleItemId) || byKey.get(spec.key);
    if (!grid) {
      return {
        key: spec.key,
        instrument: spec.instrument,
        googleItemId: spec.googleItemId,
        match: false,
        error: 'grid missing in payload',
        actualColumnCount: null,
        expectedColumnCount: spec.expectedColumnCount,
        actualRowCount: null,
        expectedRowCount: spec.expectedRowCount,
        actualColumns: [],
        expectedColumns: listV3FormScaleLabels(spec.instrument),
        columnDiffs: [],
      };
    }
    return compareActualGridToCanonical(grid, spec);
  });

  return {
    ok: results.every((r) => r.match),
    results,
  };
}
