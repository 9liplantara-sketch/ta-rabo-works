/**
 * Phase 1 — Google Form Item ID → 恒久 item_id マッピング基盤
 *
 * 責務:
 * - FormApp から Item ID / title / type / grid rows を取得
 * - 質問IDマッピング Sheet を更新（既存 item_id は上書きしない）
 * - UNMAPPED / 重複 / 不整合の validation
 *
 * 同期 payload / hash / Vercel / Neon には触れない。
 * 質問文から恒久 ID を自動推測しない。
 */

var MAPPING_SHEET_NAME = '質問IDマッピング';

var QUESTIONNAIRE_VERSION_V3 = 'member-analysis-2026-v3';

/** Phase 2 完了まで v3 Spreadsheet では同期を禁止（Script Property 明示解除まで） */
var SYNC_ENABLE_PROPERTY = 'MEMBER_ANALYSIS_SYNC_ENABLED';

var MAPPING_COLUMN_HEADERS = [
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

/** 新規行の item_id プレースホルダ（人間が確定するまで） */
var MAPPING_ITEM_ID_UNMAPPED = 'UNMAPPED';

/**
 * Form から取得した設問一覧を走査し、マッピング Sheet を更新する。
 * Script Property: MEMBER_ANALYSIS_FORM_ID（v3 Form ID）必須。
 */
function refreshMemberAnalysisQuestionMapping() {
  var formId = getScriptPropertyRequired_('MEMBER_ANALYSIS_FORM_ID');
  var form = FormApp.openById(formId);
  var formItems = extractFormMappingEntries_(form);
  var sheet = ensureMappingSheet_();
  var existing = readExistingMappingRows_(sheet);
  var merged = mergeMappingEntries_(formItems, existing);
  var diagnostics = collectMappingWriteDiagnostics_(form, formItems, merged.rows);
  Logger.log(formatMappingWriteDiagnosticsLog_(diagnostics));
  writeMappingSheet_(sheet, merged.rows);
  var validation = validateMappingRows_(merged.rows);

  var summary = formatMappingRefreshSummary_(form, merged, validation, diagnostics);
  SpreadsheetApp.getUi().alert(summary);
  return {
    ok: validation.errors.length === 0,
    formTitle: form.getTitle(),
    formVersion: QUESTIONNAIRE_VERSION_V3,
    added: merged.added,
    updated: merged.updated,
    preserved: merged.preserved,
    validation: validation,
  };
}

/**
 * マッピング Sheet の状態（UNMAPPED / 重複 / 不整合）を表示する。
 */
function showMemberAnalysisQuestionMappingStatus() {
  var sheet = ensureMappingSheet_();
  var rows = readExistingMappingRows_(sheet);
  if (!rows.length) {
    SpreadsheetApp.getUi().alert(
      '質問IDマッピング Sheet に行がありません。\n' +
      'メンバー分析 → 質問IDマッピングを更新 を実行してください。'
    );
    return;
  }
  var validation = validateMappingRows_(rows);
  SpreadsheetApp.getUi().alert(formatMappingStatusSummary_(rows, validation));
}

/** @returns {GoogleAppsScript.Spreadsheet.Sheet} */
function ensureMappingSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(MAPPING_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(MAPPING_SHEET_NAME);
  }
  var headerRange = sheet.getRange(1, 1, 1, MAPPING_COLUMN_HEADERS.length);
  var current = headerRange.getValues()[0].map(function (v) { return String(v || '').trim(); });
  var needsHeader = MAPPING_COLUMN_HEADERS.some(function (h, i) { return current[i] !== h; });
  if (needsHeader || sheet.getLastRow() < 1) {
    headerRange.setValues([MAPPING_COLUMN_HEADERS]);
    headerRange.setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/**
 * Form から mapping 行候補を生成（collectFormEntries_ 相当の本処理）。
 * Grid / CheckboxGrid は row ごとに 1 行。ItemType は enum で直接比較する。
 * @param {GoogleAppsScript.Forms.Form} form
 * @returns {Object[]}
 */
function extractFormMappingEntries_(form) {
  var entries = [];
  var items = form.getItems();
  var gridItemCount = 0;
  var gridExpandedRows = 0;

  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    var itemId = String(item.getId());
    var title = String(item.getTitle() || '').trim();
    var type = item.getType();

    if (type === FormApp.ItemType.GRID) {
      var gridRows = item.asGridItem().getRows() || [];
      gridItemCount += 1;
      gridExpandedRows += gridRows.length;
      for (var r = 0; r < gridRows.length; r++) {
        entries.push(buildMappingEntry_({
          googleItemId: itemId,
          rowIndex: r,
          rowLabel: String(gridRows[r] || '').trim(),
          sourceHeader: title,
          responseType: mapFormItemTypeToResponseType_(type),
          formItemType: type,
        }));
      }
      continue;
    }

    if (type === FormApp.ItemType.CHECKBOX_GRID) {
      var checkboxGridRows = item.asCheckboxGridItem().getRows() || [];
      gridItemCount += 1;
      gridExpandedRows += checkboxGridRows.length;
      for (var c = 0; c < checkboxGridRows.length; c++) {
        entries.push(buildMappingEntry_({
          googleItemId: itemId,
          rowIndex: c,
          rowLabel: String(checkboxGridRows[c] || '').trim(),
          sourceHeader: title,
          responseType: mapFormItemTypeToResponseType_(type),
          formItemType: type,
        }));
      }
      continue;
    }

    entries.push(buildMappingEntry_({
      googleItemId: itemId,
      rowIndex: '',
      rowLabel: '',
      sourceHeader: title,
      responseType: mapFormItemTypeToResponseType_(type),
      formItemType: type,
    }));
  }

  Logger.log(
    'extractFormMappingEntries_: formItems=' + items.length +
    ' entries=' + entries.length +
    ' gridItemCount=' + gridItemCount +
    ' gridExpandedRows=' + gridExpandedRows
  );
  return entries;
}

function buildMappingEntry_(opts) {
  var nonAnswer = isNonAnswerFormItemType_(opts.formItemType);
  return {
    form_version: QUESTIONNAIRE_VERSION_V3,
    google_item_id: opts.googleItemId,
    row_index: opts.rowIndex === '' ? '' : String(opts.rowIndex),
    row_label: opts.rowLabel || '',
    item_id: nonAnswer ? '' : MAPPING_ITEM_ID_UNMAPPED,
    question_version: '',
    response_type: opts.responseType,
    scope: '',
    instrument: '',
    dimension: '',
    reverse_scored: '',
    source_header: opts.sourceHeader,
    active: nonAnswer ? 'FALSE' : 'TRUE',
    form_item_type: opts.formItemType,
  };
}

function isNonAnswerFormItemType_(type) {
  return type === FormApp.ItemType.PAGE_BREAK
    || type === FormApp.ItemType.SECTION_HEADER
    || type === FormApp.ItemType.IMAGE
    || type === FormApp.ItemType.VIDEO;
}

/** @param {GoogleAppsScript.Forms.ItemType} type */
function getFormItemTypeName_(type) {
  try {
    return type.name();
  } catch (e) {
    return String(type);
  }
}

function mapFormItemTypeToResponseType_(type) {
  switch (type) {
    case FormApp.ItemType.TEXT:
      return 'text';
    case FormApp.ItemType.PARAGRAPH_TEXT:
      return 'paragraph';
    case FormApp.ItemType.MULTIPLE_CHOICE:
      return 'single_choice';
    case FormApp.ItemType.LIST:
      return 'dropdown';
    case FormApp.ItemType.CHECKBOX:
      return 'multi_choice';
    case FormApp.ItemType.SCALE:
      return 'scale';
    case FormApp.ItemType.GRID:
      return 'grid';
    case FormApp.ItemType.CHECKBOX_GRID:
      return 'checkbox_grid';
    case FormApp.ItemType.DATE:
      return 'date';
    case FormApp.ItemType.TIME:
      return 'time';
    case FormApp.ItemType.DATETIME:
      return 'datetime';
    case FormApp.ItemType.FILE_UPLOAD:
      return 'file';
    case FormApp.ItemType.PAGE_BREAK:
      return 'page_break';
    case FormApp.ItemType.SECTION_HEADER:
      return 'section_header';
    case FormApp.ItemType.IMAGE:
      return 'image';
    case FormApp.ItemType.VIDEO:
      return 'video';
    default:
      return getFormItemTypeName_(type);
  }
}

/** mapping key: google_item_id + row_index */
function mappingEntryKey_(row) {
  return String(row.google_item_id || '') + '\u0001' + normalizeRowIndexKey_(row.row_index);
}

function normalizeRowIndexKey_(rowIndex) {
  if (rowIndex === null || rowIndex === undefined || rowIndex === '') return '';
  return String(rowIndex);
}

/**
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @returns {Object[]}
 */
function readExistingMappingRows_(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  var width = MAPPING_COLUMN_HEADERS.length;
  // getRange(row, col, numRows, numCols) — データ行数 = lastRow - 1（行1はヘッダー）
  var values = sheet.getRange(2, 1, lastRow - 1, width).getValues();
  var rows = [];
  for (var i = 0; i < values.length; i++) {
    var row = rowValuesToMappingObject_(values[i]);
    if (!row.google_item_id) continue;
    rows.push(row);
  }
  return rows;
}

function rowValuesToMappingObject_(values) {
  var obj = {};
  for (var i = 0; i < MAPPING_COLUMN_HEADERS.length; i++) {
    obj[MAPPING_COLUMN_HEADERS[i]] = values[i] === null || values[i] === undefined
      ? ''
      : values[i];
  }
  if (obj.row_index !== '' && obj.row_index !== null && obj.row_index !== undefined) {
    obj.row_index = String(obj.row_index);
  }
  if (obj.reverse_scored !== '' && obj.reverse_scored !== null && obj.reverse_scored !== undefined) {
    obj.reverse_scored = String(obj.reverse_scored);
  }
  if (obj.active !== '' && obj.active !== null && obj.active !== undefined) {
    obj.active = String(obj.active);
  }
  return obj;
}

function mappingObjectToRowValues_(row) {
  return MAPPING_COLUMN_HEADERS.map(function (h) {
    var v = row[h];
    if (v === null || v === undefined) return '';
    return v;
  });
}

/**
 * Form 取得結果を正本とし、既存 Sheet から同一 mapping key の手動メタデータのみ保持。
 * Form に存在しない google_item_id + row_index（旧 Grid 親行・削除済み item 含む）は残さない。
 */
function mergeMappingEntries_(formEntries, existingRows) {
  var existingByKey = {};
  existingRows.forEach(function (row) {
    existingByKey[mappingEntryKey_(row)] = row;
  });

  var mergedRows = [];
  var added = 0;
  var updated = 0;
  var preserved = 0;

  formEntries.forEach(function (entry) {
    var key = mappingEntryKey_(entry);
    var prev = existingByKey[key];
    if (!prev) {
      mergedRows.push(entry);
      added += 1;
      return;
    }

    var merged = {};
    MAPPING_COLUMN_HEADERS.forEach(function (col) { merged[col] = entry[col]; });

    merged.form_version = prev.form_version || entry.form_version;
    merged.item_id = preserveItemId_(prev.item_id, entry.item_id);
    merged.question_version = prev.question_version || entry.question_version;
    merged.scope = prev.scope || entry.scope;
    merged.instrument = prev.instrument || entry.instrument;
    merged.dimension = prev.dimension || entry.dimension;
    merged.reverse_scored = prev.reverse_scored !== '' ? prev.reverse_scored : entry.reverse_scored;

    if (isConfirmedItemId_(prev.item_id)) {
      preserved += 1;
    } else {
      updated += 1;
    }
    mergedRows.push(merged);
  });

  return { rows: mergedRows, added: added, updated: updated, preserved: preserved };
}

function preserveItemId_(existingItemId, defaultItemId) {
  var existing = String(existingItemId || '').trim();
  if (isConfirmedItemId_(existing)) return existing;
  return defaultItemId;
}

function isConfirmedItemId_(itemId) {
  var v = String(itemId || '').trim();
  if (!v) return false;
  if (v === MAPPING_ITEM_ID_UNMAPPED) return false;
  return true;
}

function isUnmappedItemId_(itemId) {
  var v = String(itemId || '').trim();
  return !v || v === MAPPING_ITEM_ID_UNMAPPED;
}

/** @param {GoogleAppsScript.Spreadsheet.Sheet} sheet */
function writeMappingSheet_(sheet, rows) {
  var headers = MAPPING_COLUMN_HEADERS;
  var width = headers.length;

  // ヘッダー（行1）とデータ（行2〜）を分離して書き込む
  sheet.getRange(1, 1, 1, width).setValues([headers]);
  sheet.getRange(1, 1, 1, width).setFontWeight('bold');
  sheet.setFrozenRows(1);

  var lastRow = sheet.getLastRow();
  // getRange(row, col, numRows, numCols) — 第3引数は行数（終端行 index ではない）
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, width).clearContent();
  }
  if (!rows.length) return;

  var values = rows.map(mappingObjectToRowValues_);
  assertMappingRowValuesShape_(values, width);

  var numRows = values.length;
  if (numRows !== values.length) {
    throw new Error(
      'Mapping row count mismatch: range rows=' + numRows + ', data rows=' + values.length
    );
  }
  sheet.getRange(2, 1, numRows, width).setValues(values);
}

/**
 * @param {Array[]} values
 * @param {number} expectedCols
 */
function assertMappingRowValuesShape_(values, expectedCols) {
  values.forEach(function (row, index) {
    if (!Array.isArray(row) || row.length !== expectedCols) {
      throw new Error(
        'Mapping row width mismatch at index ' +
        index +
        ': expected=' +
        expectedCols +
        ', actual=' +
        (Array.isArray(row) ? row.length : 'not-array')
      );
    }
  });
}

/**
 * 書き込み前の件数内訳（Form 構造 / merge 結果）。
 * @param {GoogleAppsScript.Forms.Form} form
 * @param {Object[]} formEntries
 * @param {Object[]} rows
 */
function collectMappingWriteDiagnostics_(form, formEntries, rows) {
  var items = form.getItems();
  var gridItemCount = 0;
  var checkboxGridItemCount = 0;
  var gridExpandedRowsTotal = 0;
  var gridDetails = [];

  for (var i = 0; i < items.length; i++) {
    var type = items[i].getType();
    if (type !== FormApp.ItemType.GRID && type !== FormApp.ItemType.CHECKBOX_GRID) continue;

    var isGrid = type === FormApp.ItemType.GRID;
    if (isGrid) {
      gridItemCount += 1;
    } else {
      checkboxGridItemCount += 1;
    }

    var gridItem = isGrid ? items[i].asGridItem() : items[i].asCheckboxGridItem();
    var gridRows = gridItem.getRows() || [];
    var rowsLength = gridRows.length;
    gridExpandedRowsTotal += rowsLength;

    gridDetails.push({
      type: isGrid ? 'GRID' : 'CHECKBOX_GRID',
      title: String(items[i].getTitle() || '').trim() || '(無題)',
      googleItemId: String(items[i].getId()),
      rowsLength: rowsLength,
    });
  }

  var activeRows = 0;
  var inactiveRows = 0;
  rows.forEach(function (row) {
    if (String(row.active || '').toUpperCase() === 'FALSE') {
      inactiveRows += 1;
    } else {
      activeRows += 1;
    }
  });

  return {
    formItemsTotal: items.length,
    formEntriesTotal: formEntries.length,
    mappingRowsTotal: rows.length,
    activeRows: activeRows,
    inactiveRows: inactiveRows,
    gridItemCount: gridItemCount,
    checkboxGridItemCount: checkboxGridItemCount,
    gridExpandedRowsTotal: gridExpandedRowsTotal,
    gridDetails: gridDetails,
    headersLength: MAPPING_COLUMN_HEADERS.length,
  };
}

/** @param {ReturnType<typeof collectMappingWriteDiagnostics_>} diagnostics */
function formatMappingGridDetailLines_(diagnostics) {
  var lines = [];
  if (!diagnostics.gridDetails.length) {
    lines.push('  (Grid なし)');
    return lines;
  }
  diagnostics.gridDetails.forEach(function (grid, index) {
    lines.push(
      '  ' + (index + 1) + '. [' + grid.type + '] ' + grid.title +
      ' — rows.length=' + grid.rowsLength +
      ' (item_id=' + grid.googleItemId + ')'
    );
  });
  return lines;
}

/** @param {ReturnType<typeof collectMappingWriteDiagnostics_>} diagnostics */
function formatMappingWriteDiagnosticsLog_(diagnostics) {
  var lines = [
    'Mapping write diagnostics',
    'Form items total: ' + diagnostics.formItemsTotal,
    'Mapping rows total: ' + diagnostics.mappingRowsTotal,
    'active rows: ' + diagnostics.activeRows,
    'inactive rows: ' + diagnostics.inactiveRows,
    'GRID item count: ' + diagnostics.gridItemCount,
    'CHECKBOX_GRID item count: ' + diagnostics.checkboxGridItemCount,
    'Grid expanded rows total: ' + diagnostics.gridExpandedRowsTotal,
    'Grid ごとの内訳:',
  ];
  formatMappingGridDetailLines_(diagnostics).forEach(function (line) { lines.push(line); });
  lines.push('Form entries total (Grid展開後): ' + diagnostics.formEntriesTotal);
  lines.push('headers.length: ' + diagnostics.headersLength);
  return lines.join('\n');
}

/**
 * @param {Object[]} rows
 * @returns {{ unmapped: number, duplicateKeys: string[], duplicateItemIds: string[], headerConflicts: string[], errors: string[], warnings: string[] }}
 */
function validateMappingRows_(rows) {
  var unmapped = 0;
  var keyCounts = {};
  var itemIdCounts = {};
  var headerByItemId = {};
  var duplicateKeys = [];
  var duplicateItemIds = [];
  var headerConflicts = [];
  var errors = [];
  var warnings = [];

  rows.forEach(function (row) {
    if (String(row.active || '').toUpperCase() === 'FALSE') return;

    if (isUnmappedItemId_(row.item_id)) {
      unmapped += 1;
    }

    var key = mappingEntryKey_(row);
    keyCounts[key] = (keyCounts[key] || 0) + 1;

    var itemId = String(row.item_id || '').trim();
    if (isConfirmedItemId_(itemId)) {
      itemIdCounts[itemId] = (itemIdCounts[itemId] || 0) + 1;
      if (!headerByItemId[itemId]) {
        headerByItemId[itemId] = String(row.source_header || '').trim();
      } else if (headerByItemId[itemId] !== String(row.source_header || '').trim()) {
        headerConflicts.push(itemId + ': ' + headerByItemId[itemId] + ' vs ' + row.source_header);
      }
    }
  });

  Object.keys(keyCounts).forEach(function (key) {
    if (keyCounts[key] > 1) duplicateKeys.push(key);
  });
  Object.keys(itemIdCounts).forEach(function (itemId) {
    if (itemIdCounts[itemId] > 1) duplicateItemIds.push(itemId);
  });

  if (duplicateKeys.length) {
    errors.push('google_item_id + row_index の重複: ' + duplicateKeys.length + ' 件');
  }
  if (duplicateItemIds.length) {
    errors.push('item_id の重複: ' + duplicateItemIds.join(', '));
  }
  if (headerConflicts.length) {
    warnings.push('同一 item_id で source_header が不一致: ' + headerConflicts.length + ' 件');
  }
  if (unmapped > 0) {
    warnings.push('UNMAPPED（要人手確定）: ' + unmapped + ' 件');
  }

  return {
    unmapped: unmapped,
    duplicateKeys: duplicateKeys,
    duplicateItemIds: duplicateItemIds,
    headerConflicts: headerConflicts,
    errors: errors,
    warnings: warnings,
  };
}

function formatMappingRefreshSummary_(form, merged, validation, diagnostics) {
  var lines = [
    '質問IDマッピングを更新しました',
    '',
    'Form: ' + form.getTitle(),
    'form_version: ' + QUESTIONNAIRE_VERSION_V3,
    'Form Item 数: ' + form.getItems().length,
    'マッピング行数: ' + merged.rows.length,
    '新規: ' + merged.added,
    'メタ更新（item_id保持）: ' + merged.updated,
    'item_id 確定済み保持: ' + merged.preserved,
  ];
  if (diagnostics) {
    lines.push('');
    lines.push('【書き込み内訳】');
    lines.push('Form items total: ' + diagnostics.formItemsTotal);
    lines.push('Mapping rows total: ' + diagnostics.mappingRowsTotal);
    lines.push('active rows: ' + diagnostics.activeRows);
    lines.push('inactive rows: ' + diagnostics.inactiveRows);
    lines.push('GRID item count: ' + diagnostics.gridItemCount);
    lines.push('CHECKBOX_GRID item count: ' + diagnostics.checkboxGridItemCount);
    lines.push('Grid expanded rows total: ' + diagnostics.gridExpandedRowsTotal);
    lines.push('Grid ごとの内訳:');
    formatMappingGridDetailLines_(diagnostics).forEach(function (line) { lines.push(line); });
    lines.push('Form entries (Grid展開後): ' + diagnostics.formEntriesTotal);
    lines.push('headers.length: ' + diagnostics.headersLength);
  }
  lines.push('');
  lines.push('UNMAPPED: ' + validation.unmapped + ' 件');
  if (validation.errors.length) {
    lines.push('');
    lines.push('【エラー】');
    validation.errors.forEach(function (e) { lines.push('- ' + e); });
  }
  if (validation.warnings.length) {
    lines.push('');
    lines.push('【警告】');
    validation.warnings.forEach(function (w) { lines.push('- ' + w); });
  }
  lines.push('');
  lines.push('恒久 item_id は Sheet 上で人手確定してください。');
  lines.push('質問文からの自動推測は行いません。');
  return lines.join('\n');
}

function formatMappingStatusSummary_(rows, validation) {
  var activeRows = rows.filter(function (row) {
    return String(row.active || '').toUpperCase() !== 'FALSE';
  });
  var confirmed = activeRows.filter(function (row) {
    return isConfirmedItemId_(row.item_id);
  }).length;

  var lines = [
    '質問IDマッピング 状態',
    '',
    'form_version: ' + QUESTIONNAIRE_VERSION_V3,
    '総行数: ' + rows.length,
    'active 行: ' + activeRows.length,
    'item_id 確定済み: ' + confirmed,
    'UNMAPPED: ' + validation.unmapped + ' 件',
  ];
  if (validation.errors.length) {
    lines.push('');
    lines.push('【エラー】');
    validation.errors.forEach(function (e) { lines.push('- ' + e); });
  }
  if (validation.warnings.length) {
    lines.push('');
    lines.push('【警告】');
    validation.warnings.forEach(function (w) { lines.push('- ' + w); });
  }
  if (!validation.errors.length && validation.unmapped === 0) {
    lines.push('');
    lines.push('全 active 行に item_id が設定されています。');
  } else if (validation.unmapped > 0) {
    lines.push('');
    lines.push('Phase 2 同期前に UNMAPPED を人手で確定してください。');
  }
  return lines.join('\n');
}

/**
 * Form 全 item の ItemType を診断（開発用）。
 * 実行ログに全 item 分の type / enum 一致を出力する。
 */
function debugMemberAnalysisFormItemTypes() {
  var formId = getScriptPropertyRequired_('MEMBER_ANALYSIS_FORM_ID');
  var form = FormApp.openById(formId);
  var items = form.getItems();
  var typeCounts = {};
  var gridCount = 0;
  var checkboxGridCount = 0;
  var inactiveCount = 0;

  items.forEach(function (item, index) {
    var type = item.getType();
    var typeName = getFormItemTypeName_(type);
    typeCounts[typeName] = (typeCounts[typeName] || 0) + 1;

    var isGrid = type === FormApp.ItemType.GRID;
    var isCheckboxGrid = type === FormApp.ItemType.CHECKBOX_GRID;
    if (isGrid) gridCount += 1;
    if (isCheckboxGrid) checkboxGridCount += 1;
    if (isNonAnswerFormItemType_(type)) inactiveCount += 1;

    var rowsLength = '';
    if (isGrid) {
      rowsLength = String((item.asGridItem().getRows() || []).length);
    } else if (isCheckboxGrid) {
      rowsLength = String((item.asCheckboxGridItem().getRows() || []).length);
    }

    Logger.log(
      [
        'index=' + index,
        'id=' + item.getId(),
        'typeName=' + typeName,
        'stringType=' + String(type),
        'isGRID=' + isGrid,
        'isCHECKBOX_GRID=' + isCheckboxGrid,
        'isPAGE_BREAK=' + (type === FormApp.ItemType.PAGE_BREAK),
        'isSECTION_HEADER=' + (type === FormApp.ItemType.SECTION_HEADER),
        'rows.length=' + rowsLength,
        'title=' + item.getTitle(),
      ].join(' | ')
    );
  });

  var summary = [
    'Form ItemType 診断完了',
    'Form: ' + form.getTitle(),
    'Form items total: ' + items.length,
    'GRID item count: ' + gridCount,
    'CHECKBOX_GRID item count: ' + checkboxGridCount,
    'inactive-capable items: ' + inactiveCount,
    'type counts: ' + JSON.stringify(typeCounts),
    '',
    '詳細は Apps Script 実行ログを確認してください。',
  ].join('\n');

  SpreadsheetApp.getUi().alert(summary);
  return { items: items.length, gridCount: gridCount, checkboxGridCount: checkboxGridCount, typeCounts: typeCounts };
}

/**
 * 4 尺度 Grid の title / rows.length を診断（開発用）。
 */
function debugMemberAnalysisFormScaleGrids() {
  var formId = getScriptPropertyRequired_('MEMBER_ANALYSIS_FORM_ID');
  var form = FormApp.openById(formId);
  var items = form.getItems();
  var patterns = [
    { label: 'Big Five', match: /性格・行動|Big Five|BIG FIVE/i },
    { label: 'Values', match: /価値観/i },
    { label: 'Regulatory Focus', match: /目標に向かう|Regulatory|制御焦点/i },
    { label: 'RIASEC', match: /活動・職業|RIASEC/i },
  ];
  var lines = ['尺度 Grid 診断', 'Form: ' + form.getTitle(), ''];
  var gridExpandedTotal = 0;

  patterns.forEach(function (pattern) {
    var matched = false;
    items.forEach(function (item, index) {
      var title = String(item.getTitle() || '').trim();
      if (!pattern.match.test(title)) return;

      var type = item.getType();
      var typeName = getFormItemTypeName_(type);
      var rowsLength = '';
      if (type === FormApp.ItemType.GRID) {
        rowsLength = String((item.asGridItem().getRows() || []).length);
        gridExpandedTotal += Number(rowsLength) || 0;
      } else if (type === FormApp.ItemType.CHECKBOX_GRID) {
        rowsLength = String((item.asCheckboxGridItem().getRows() || []).length);
        gridExpandedTotal += Number(rowsLength) || 0;
      }

      matched = true;
      var detail = [
        pattern.label,
        'index=' + index,
        'google_item_id=' + item.getId(),
        'title=' + title,
        'typeName=' + typeName,
        'String(type)=' + String(type),
        'enum GRID=' + (type === FormApp.ItemType.GRID),
        'enum CHECKBOX_GRID=' + (type === FormApp.ItemType.CHECKBOX_GRID),
        'rows.length=' + (rowsLength || '(not grid)'),
      ].join(' | ');
      lines.push(detail);
      Logger.log(detail);
    });
    if (!matched) {
      lines.push(pattern.label + ': (該当 item なし — title を確認)');
    }
  });

  lines.push('');
  lines.push('Grid expanded rows total (matched only): ' + gridExpandedTotal);
  lines.push('期待目安: Big Five=20, Values=20, Regulatory=10, RIASEC=24 → total=74');

  var summary = lines.join('\n');
  SpreadsheetApp.getUi().alert(summary);
  return summary;
}

/** metadata 反映対象列（QuestionMappingMetadata.gs の監査済み定数と対） */
var METADATA_APPLY_COLUMN_NAMES = [
  'item_id',
  'question_version',
  'scope',
  'instrument',
  'dimension',
  'reverse_scored',
];

var METADATA_APPLY_EXPECTED_ACTIVE_ROWS = 118;
var METADATA_APPLY_EXPECTED_INACTIVE_ROWS = 12;
var METADATA_APPLY_EXPECTED_TOTAL_ROWS = 130;

/**
 * 監査済み metadata の dry-run（Sheet へは書き込まない）。
 * 前提: QuestionMappingMetadata.gs がデプロイ済み。
 */
function previewMemberAnalysisV3MappingMetadata() {
  var result = runMetadataApplyValidation_({ includeDiffLog: true });
  if (!result.ok) {
    SpreadsheetApp.getUi().alert(formatMetadataApplyFailure_(result));
    return result;
  }

  var summary = formatMetadataApplyPreviewSummary_(result);
  Logger.log(summary);
  if (result.diffLog) Logger.log(result.diffLog);
  SpreadsheetApp.getUi().alert(summary);
  return result;
}

/**
 * 監査済み metadata を Mapping Sheet へ反映。
 * dry-run と同一 validation を再実行し、全条件 PASS 時のみ書き込む。
 */
function applyMemberAnalysisV3MappingMetadata() {
  var result = runMetadataApplyValidation_({ includeDiffLog: true });
  if (!result.ok) {
    SpreadsheetApp.getUi().alert(formatMetadataApplyFailure_(result));
    return result;
  }

  if (result.plan.rowsToUpdate === 0) {
    var noopSummary = formatMetadataApplyPreviewSummary_(result) + '\n\n変更なし — 反映をスキップしました。';
    SpreadsheetApp.getUi().alert(noopSummary);
    return result;
  }

  var sheet = result.sheet;
  result.plan.updates.forEach(function (update) {
    METADATA_APPLY_COLUMN_NAMES.forEach(function (colName) {
      var col = MAPPING_COLUMN_HEADERS.indexOf(colName) + 1;
      sheet.getRange(update.rowNumber, col).setValue(update.values[colName]);
    });
  });

  var verify = runMetadataApplyValidation_({ includeDiffLog: false, postApply: true });
  if (!verify.ok) {
    SpreadsheetApp.getUi().alert(
      'metadata を書き込みましたが、事後検証で問題が見つかりました。\n\n' +
      formatMetadataApplyFailure_(verify)
    );
    return { ok: false, applied: true, verify: verify };
  }

  var done = formatMetadataApplyPreviewSummary_(verify) + '\n\n反映完了。';
  SpreadsheetApp.getUi().alert(done);
  return { ok: true, applied: true, verify: verify };
}

/**
 * @param {{ includeDiffLog?: boolean, postApply?: boolean }} opts
 */
function runMetadataApplyValidation_(opts) {
  opts = opts || {};
  var errors = [];

  try {
    getScriptPropertyRequired_('MEMBER_ANALYSIS_FORM_ID');
  } catch (e) {
    errors.push(String(e.message || e));
    return { ok: false, errors: errors };
  }

  if (typeof MEMBER_ANALYSIS_V3_MAPPING_METADATA === 'undefined') {
    errors.push('QuestionMappingMetadata.gs が未デプロイ（MEMBER_ANALYSIS_V3_MAPPING_METADATA 未定義）');
    return { ok: false, errors: errors };
  }

  var metadata = MEMBER_ANALYSIS_V3_MAPPING_METADATA;
  if (!metadata || metadata.length !== METADATA_APPLY_EXPECTED_ACTIVE_ROWS) {
    errors.push(
      'metadata entries: expected ' + METADATA_APPLY_EXPECTED_ACTIVE_ROWS +
      ', got ' + (metadata ? metadata.length : 0)
    );
  }

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(MAPPING_SHEET_NAME);
  if (!sheet) {
    errors.push('質問IDマッピング Sheet が存在しません');
    return { ok: false, errors: errors };
  }

  var sheetRows = readAllMappingSheetRows_(sheet);
  var activeRows = sheetRows.filter(function (r) {
    return String(r.data.active || '').toUpperCase() === 'TRUE';
  });
  var inactiveRows = sheetRows.filter(function (r) {
    return String(r.data.active || '').toUpperCase() === 'FALSE';
  });

  if (sheetRows.length !== METADATA_APPLY_EXPECTED_TOTAL_ROWS) {
    errors.push('Sheet data rows: expected ' + METADATA_APPLY_EXPECTED_TOTAL_ROWS + ', got ' + sheetRows.length);
  }
  if (activeRows.length !== METADATA_APPLY_EXPECTED_ACTIVE_ROWS) {
    errors.push('Sheet active rows: expected ' + METADATA_APPLY_EXPECTED_ACTIVE_ROWS + ', got ' + activeRows.length);
  }
  if (inactiveRows.length !== METADATA_APPLY_EXPECTED_INACTIVE_ROWS) {
    errors.push('Sheet inactive rows: expected ' + METADATA_APPLY_EXPECTED_INACTIVE_ROWS + ', got ' + inactiveRows.length);
  }

  var metadataByKey = buildMetadataByKey_(metadata || []);
  var sheetActiveByKey = {};
  activeRows.forEach(function (row) {
    var key = mappingEntryKey_(row.data);
    if (sheetActiveByKey[key]) errors.push('duplicate Sheet key: ' + key);
    sheetActiveByKey[key] = row;
  });

  var unmatchedSheet = [];
  var unmatchedMetadata = [];
  Object.keys(sheetActiveByKey).forEach(function (key) {
    if (!metadataByKey[key]) unmatchedSheet.push(key);
  });
  Object.keys(metadataByKey).forEach(function (key) {
    if (!sheetActiveByKey[key]) unmatchedMetadata.push(key);
  });
  if (unmatchedSheet.length) errors.push('unmatched Sheet active keys: ' + unmatchedSheet.length);
  if (unmatchedMetadata.length) errors.push('unmatched metadata keys: ' + unmatchedMetadata.length);

  var itemIdCounts = {};
  (metadata || []).forEach(function (entry) {
    var id = String(entry.item_id || '').trim();
    if (!id) errors.push('metadata with empty item_id');
    itemIdCounts[id] = (itemIdCounts[id] || 0) + 1;
  });
  Object.keys(itemIdCounts).forEach(function (id) {
    if (itemIdCounts[id] > 1) errors.push('duplicate metadata item_id: ' + id);
  });

  var plan = buildMetadataApplyPlan_(sheetRows, metadataByKey);
  var diffLog = '';
  if (opts.includeDiffLog && plan.diffs.length) {
    diffLog = formatMetadataApplyDiffLog_(plan.diffs);
  }

  if (opts.postApply) {
    var postErrors = validatePostApplyMetadataState_(activeRows, metadataByKey);
    errors = errors.concat(postErrors);
  }

  return {
    ok: errors.length === 0,
    errors: errors,
    sheet: sheet,
    sheetRows: sheetRows,
    activeRows: activeRows,
    inactiveRows: inactiveRows,
    metadata: metadata,
    metadataByKey: metadataByKey,
    plan: plan,
    diffLog: diffLog,
  };
}

/** @param {GoogleAppsScript.Spreadsheet.Sheet} sheet */
function readAllMappingSheetRows_(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  var width = MAPPING_COLUMN_HEADERS.length;
  var values = sheet.getRange(2, 1, lastRow - 1, width).getValues();
  var rows = [];
  for (var i = 0; i < values.length; i++) {
    var data = rowValuesToMappingObject_(values[i]);
    if (!data.google_item_id) continue;
    rows.push({ rowNumber: i + 2, data: data });
  }
  return rows;
}

/** @param {Object[]} metadata */
function buildMetadataByKey_(metadata) {
  var byKey = {};
  metadata.forEach(function (entry) {
    byKey[mappingEntryKey_(entry)] = normalizeMetadataEntry_(entry);
  });
  return byKey;
}

/** @param {Object} entry */
function normalizeMetadataEntry_(entry) {
  return {
    google_item_id: String(entry.google_item_id || ''),
    row_index: entry.row_index === null || entry.row_index === undefined || entry.row_index === ''
      ? ''
      : String(entry.row_index),
    item_id: String(entry.item_id || ''),
    question_version: String(entry.question_version || ''),
    scope: String(entry.scope || ''),
    instrument: String(entry.instrument || ''),
    dimension: String(entry.dimension || ''),
    reverse_scored: normalizeMetadataBoolString_(entry.reverse_scored),
  };
}

function normalizeMetadataBoolString_(value) {
  var v = String(value || '').trim().toUpperCase();
  if (v === 'TRUE' || v === '1') return 'TRUE';
  return 'FALSE';
}

/**
 * @param {{ rowNumber: number, data: Object }[]} sheetRows
 * @param {Object} metadataByKey
 */
function buildMetadataApplyPlan_(sheetRows, metadataByKey) {
  var updates = [];
  var diffs = [];
  var rowsToUpdate = 0;
  var rowsUnchanged = 0;

  sheetRows.forEach(function (row) {
    if (String(row.data.active || '').toUpperCase() !== 'TRUE') {
      rowsUnchanged += 1;
      return;
    }

    var key = mappingEntryKey_(row.data);
    var meta = metadataByKey[key];
    if (!meta) return;

    var values = {
      item_id: meta.item_id,
      question_version: meta.question_version,
      scope: meta.scope,
      instrument: meta.instrument,
      dimension: meta.dimension,
      reverse_scored: meta.reverse_scored,
    };

    var changes = [];
    METADATA_APPLY_COLUMN_NAMES.forEach(function (colName) {
      var oldVal = String(row.data[colName] || '');
      var newVal = String(values[colName] || '');
      if (oldVal !== newVal) {
        changes.push({ field: colName, old: oldVal, new: newVal });
      }
    });

    if (changes.length) {
      rowsToUpdate += 1;
      updates.push({ rowNumber: row.rowNumber, key: key, values: values, changes: changes });
      diffs.push({
        google_item_id: row.data.google_item_id,
        row_index: row.data.row_index,
        changes: changes,
      });
    } else {
      rowsUnchanged += 1;
    }
  });

  return {
    rowsToUpdate: rowsToUpdate,
    rowsUnchanged: rowsUnchanged,
    updates: updates,
    diffs: diffs,
  };
}

/** @param {Object[]} diffs */
function formatMetadataApplyDiffLog_(diffs) {
  var lines = ['Metadata apply diff preview:'];
  diffs.forEach(function (d) {
    lines.push('google_item_id=' + d.google_item_id + ' row_index=' + d.row_index);
    d.changes.forEach(function (c) {
      lines.push('  ' + c.field + ': "' + c.old + '" → "' + c.new + '"');
    });
  });
  return lines.join('\n');
}

/** @param {Object} result */
function formatMetadataApplyPreviewSummary_(result) {
  var plan = result.plan || { rowsToUpdate: 0, rowsUnchanged: 0, diffs: [] };
  var lines = [
    'Mapping metadata プレビュー',
    '',
    'rows to update = ' + plan.rowsToUpdate,
    'rows unchanged = ' + plan.rowsUnchanged,
    '',
    'item_id assigned = ' + (result.metadata ? result.metadata.length : 0),
    'question_version assigned = ' + (result.metadata ? result.metadata.length : 0),
    'scope assigned = ' + (result.metadata ? result.metadata.length : 0),
    '',
    'duplicate item_id = 0',
    'unmatched = 0',
    'validation = PASS',
  ];
  if (plan.rowsToUpdate > 0) {
    lines.push('');
    lines.push('変更予定 ' + plan.rowsToUpdate + ' 行 — 詳細は実行ログ');
  }
  return lines.join('\n');
}

/** @param {Object} result */
function formatMetadataApplyFailure_(result) {
  var lines = ['Mapping metadata 反映を中止しました', ''];
  (result.errors || []).forEach(function (e) { lines.push('- ' + e); });
  return lines.join('\n');
}

/**
 * apply 後: active 118 件の metadata が監査済み定数と一致するか。
 * @param {{ data: Object }[]} activeRows
 * @param {Object} metadataByKey
 */
function validatePostApplyMetadataState_(activeRows, metadataByKey) {
  var errors = [];
  var itemIds = {};

  activeRows.forEach(function (row) {
    var key = mappingEntryKey_(row.data);
    var meta = metadataByKey[key];
    if (!meta) {
      errors.push('post-apply unmatched key: ' + key);
      return;
    }
    METADATA_APPLY_COLUMN_NAMES.forEach(function (col) {
      var sheetVal = String(row.data[col] || '');
      var metaVal = String(meta[col] || '');
      if (col === 'reverse_scored') {
        sheetVal = normalizeMetadataBoolString_(sheetVal);
        metaVal = normalizeMetadataBoolString_(metaVal);
      }
      if (sheetVal !== metaVal) {
        errors.push('post-apply mismatch ' + key + ' ' + col + ': sheet=' + sheetVal + ' meta=' + metaVal);
      }
    });
    var id = String(row.data.item_id || '').trim();
    if (id) itemIds[id] = (itemIds[id] || 0) + 1;
  });

  if (Object.keys(itemIds).length !== METADATA_APPLY_EXPECTED_ACTIVE_ROWS) {
    errors.push('post-apply unique item_id: expected 118, got ' + Object.keys(itemIds).length);
  }
  Object.keys(itemIds).forEach(function (id) {
    if (itemIds[id] > 1) errors.push('post-apply duplicate item_id: ' + id);
  });

  return errors;
}

/**
 * v3 Spreadsheet では Phase 2 完了まで同期をブロックする。
 * MEMBER_ANALYSIS_SYNC_ENABLED=true のときのみ v3 でも同期許可。
 *
 * @returns {{ blocked: boolean, reason: string }}
 */
function getMemberAnalysisSyncBlockInfo_() {
  var props = PropertiesService.getScriptProperties();
  var syncEnabled = String(props.getProperty(SYNC_ENABLE_PROPERTY) || '').trim().toLowerCase();
  if (syncEnabled === 'true' || syncEnabled === '1') {
    return { blocked: false, reason: '' };
  }

  if (syncEnabled === 'false' || syncEnabled === '0') {
    return {
      blocked: true,
      reason: buildSyncBlockedMessage_('MEMBER_ANALYSIS_SYNC_ENABLED=false'),
    };
  }

  var configuredVersion = String(props.getProperty('MEMBER_ANALYSIS_QUESTIONNAIRE_VERSION') || '').trim();
  if (configuredVersion === QUESTIONNAIRE_VERSION_V3) {
    return {
      blocked: true,
      reason: buildSyncBlockedMessage_('MEMBER_ANALYSIS_QUESTIONNAIRE_VERSION=' + QUESTIONNAIRE_VERSION_V3),
    };
  }

  if (String(props.getProperty('MEMBER_ANALYSIS_FORM_ID') || '').trim()) {
    return {
      blocked: true,
      reason: buildSyncBlockedMessage_('MEMBER_ANALYSIS_FORM_ID が設定されています（v3 Mapping 用）'),
    };
  }

  if (hasV3QuestionMappingSheet_()) {
    return {
      blocked: true,
      reason: buildSyncBlockedMessage_('質問IDマッピング Sheet に form_version=' + QUESTIONNAIRE_VERSION_V3 + ' が存在します'),
    };
  }

  return { blocked: false, reason: '' };
}

function buildSyncBlockedMessage_(detail) {
  return [
    '同期は Phase 2 完了まで無効です。',
    '',
    '理由: ' + detail,
    '',
    'v3 Form 回答を現行 sync（v1 header-based）で送信すると、',
    'v1 として誤採点される可能性があります。',
    '',
    'Phase 1 では Mapping のみ実施してください。',
    'Phase 2 完了後に MEMBER_ANALYSIS_SYNC_ENABLED=true を設定してください。',
    '',
    '定期 trigger が設定されている場合は、Phase 2 まで無効化してください。',
  ].join('\n');
}

/** @returns {boolean} */
function hasV3QuestionMappingSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(MAPPING_SHEET_NAME);
  if (!sheet || sheet.getLastRow() < 2) return false;

  var formVersionCol = MAPPING_COLUMN_HEADERS.indexOf('form_version') + 1;
  if (formVersionCol <= 0) return false;

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return false;

  var values = sheet.getRange(2, formVersionCol, lastRow - 1, 1).getValues();
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][0] || '').trim() === QUESTIONNAIRE_VERSION_V3) {
      return true;
    }
  }
  return false;
}
