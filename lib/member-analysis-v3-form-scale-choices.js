/**
 * v3 Grid 尺度 — Form 列 choice 文字列 → numeric value（scorer 内部のみ）
 *
 * 正本: 2026 v3 Google Form Grid getColumns() 実測（2026-09-01）
 * test/fixtures/member-analysis-v3-form-scale-columns-actual.json
 * item_answers / DB には raw label をそのまま保存する（Phase 2 contract）。
 */

/** @type {Record<string, ReadonlyMap<string, number>>} */
export const V3_FORM_SCALE_LABEL_TO_VALUE = {
  lab_big5: new Map([
    ['1：全く当てはまらない', 1],
    ['2：ほとんど当てはまらない', 2],
    ['3：あまり当てはまらない', 3],
    ['4：どちらともいえない', 4],
    ['5：やや当てはまる', 5],
    ['6：かなり当てはまる', 6],
    ['7：とても当てはまる', 7],
  ]),
  lab_values: new Map([
    ['1：全く似ていない', 1],
    ['2：似ていない', 2],
    ['3：あまり似ていない', 3],
    ['4：少し似ている', 4],
    ['5：似ている', 5],
    ['6：とても似ている', 6],
  ]),
  lab_regulatory_focus: new Map([
    ['1：全く当てはまらない', 1],
    ['2：あまり当てはまらない', 2],
    ['3：どちらともいえない', 3],
    ['4：当てはまる', 4],
    ['5：とても当てはまる', 5],
  ]),
  lab_riasec: new Map([
    ['1. 全くやりたくない', 1],
    ['2. あまりやりたくない', 2],
    ['3. どちらともいえない', 3],
    ['4. やってみたい', 4],
    ['5. とてもやってみたい', 5],
  ]),
};

/** @param {string} instrument */
export function getV3FormScaleLabelMap(instrument) {
  return V3_FORM_SCALE_LABEL_TO_VALUE[instrument] || null;
}

/** @param {string} instrument */
export function listV3FormScaleLabels(instrument) {
  const map = getV3FormScaleLabelMap(instrument);
  return map ? [...map.keys()] : [];
}
