/**
 * メンバー分析 — Google Form 回答シート → Vercel 差分同期
 * 研究会スケジュール GAS とは完全に独立。
 *
 * lib/member-analysis-questionnaire-v1.js の header 分類と同期すること。
 *
 * Phase 1: QuestionMapping.gs — Form Item ID → 恒久 item_id（同期とは独立）
 */

/** 1 リクエストあたりの回答数 */
var SYNC_BATCH_SIZE = 50;

/** 1 回の実行で処理する最大行数（GAS 実行時間上限対策） */
var SYNC_MAX_ROWS_PER_RUN = 200;

/** LockService 取得試行（ms）— 定期 trigger と手動同期の二重実行防止 */
var SYNC_LOCK_TIMEOUT_MS = 30000;

var SYNC_COLUMN_HEADERS = [
  'member_analysis_sync_id',
  'member_analysis_sync_status',
  'member_analysis_synced_at',
  'member_analysis_sync_hash',
  'member_analysis_sync_error',
];

/** raw_answers / hash から除外（legacy 列）。lib rawExcludeHeaders と同期 */
var RAW_EXCLUDE_HEADERS = [
  '列 94',
];

var META_HEADERS = {
  timestamp: ['タイムスタンプ'],
  /** 現 Sheet には無し。Form でメール収集を有効化した場合に自動認識 */
  email: ['メールアドレス', 'Email Address'],
  name: ['Q1. 氏名（必須）', '氏名', 'お名前', '名前'],
};

var QUESTIONNAIRE_VERSION = 'member-analysis-2026-v1';
var SYNC_SOURCE = 'google_forms_sheet';

var SYNC_STATUS_SYNCED = 'synced';
var SYNC_STATUS_ERROR = 'error';

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('メンバー分析')
    .addItem('今すぐ同期', 'runMemberAnalysisSyncNow')
    .addItem('同期状態を確認', 'showMemberAnalysisSyncStatus')
    .addSeparator()
    .addItem('質問IDマッピングを更新', 'refreshMemberAnalysisQuestionMapping')
    .addItem('質問IDマッピングを確認', 'showMemberAnalysisQuestionMappingStatus')
    .addSeparator()
    .addItem('Form ItemType 診断（開発）', 'debugMemberAnalysisFormItemTypes')
    .addItem('尺度 Grid 診断（開発）', 'debugMemberAnalysisFormScaleGrids')
    .addItem('v3 Form scale columns 診断', 'debugMemberAnalysisV3FormScaleColumns')
    .addSeparator()
    .addItem('Mapping metadata プレビュー', 'previewMemberAnalysisV3MappingMetadata')
    .addItem('Mapping metadata 反映', 'applyMemberAnalysisV3MappingMetadata')
    .addSeparator()
    .addItem('v3 Sync Payload プレビュー', 'previewMemberAnalysisV3SyncPayload')
    .addToUi();
}

function runMemberAnalysisSyncNow() {
  var result = syncMemberAnalysisResponses({ manual: true });
  SpreadsheetApp.getUi().alert(formatSyncResultSummary(result));
}

function showMemberAnalysisSyncStatus() {
  var sheet = getMemberAnalysisResponseSheet_();
  var headerMap = buildHeaderIndexMap_(sheet);
  ensureSyncColumns_(sheet, headerMap);
  headerMap = buildHeaderIndexMap_(sheet);

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    SpreadsheetApp.getUi().alert('回答行がありません。');
    return;
  }

  var counts = { synced: 0, pending: 0, error: 0, total: lastRow - 1 };
  var statusCol = headerMap.member_analysis_sync_status;
  if (statusCol) {
    var values = sheet.getRange(2, statusCol, lastRow - 1, 1).getValues();
    values.forEach(function (row) {
      var s = String(row[0] || '').trim();
      if (s === SYNC_STATUS_SYNCED) counts.synced += 1;
      else if (s === SYNC_STATUS_ERROR) counts.error += 1;
      else counts.pending += 1;
    });
  }

  SpreadsheetApp.getUi().alert(
    '回答行: ' + counts.total + '\n' +
    'synced: ' + counts.synced + '\n' +
    'error: ' + counts.error + '\n' +
    'pending/その他: ' + counts.pending
  );
}

/**
 * 定期 trigger から呼ぶエントリ（installable trigger は手動設定）
 */
function syncMemberAnalysisResponses(options) {
  options = options || {};

  var lock = LockService.getDocumentLock();
  var locked = lock.tryLock(SYNC_LOCK_TIMEOUT_MS);
  if (!locked) {
    return {
      ok: false,
      message: 'sync already running (lock not acquired)',
      batches: 0,
      synced: 0,
      failed: 0,
      locked: true,
    };
  }

  try {
    return syncMemberAnalysisResponsesCore_(options);
  } finally {
    lock.releaseLock();
  }
}

function syncMemberAnalysisResponsesCore_(options) {
  var block = getMemberAnalysisSyncBlockInfo_();
  if (block.blocked) {
    return {
      ok: false,
      blocked: true,
      message: block.reason,
      batches: 0,
      synced: 0,
      failed: 0,
      manual: !!(options && options.manual),
    };
  }

  var sheet = getMemberAnalysisResponseSheet_();
  var headerMap = buildHeaderIndexMap_(sheet);
  ensureSyncColumns_(sheet, headerMap);
  headerMap = buildHeaderIndexMap_(sheet);

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return { ok: true, message: 'no data rows', batches: 0, synced: 0, failed: 0 };
  }

  var syncCols = getSyncColumnIndexes_(headerMap);
  var dataWidth = sheet.getLastColumn();
  var allRows = sheet.getRange(2, 1, lastRow - 1, dataWidth).getValues();

  var candidates = [];
  for (var i = 0; i < allRows.length; i++) {
    var rowNumber = i + 2;
    var rowValues = allRows[i];
    var decision = evaluateSyncNeed_(rowValues, headerMap, syncCols);
    if (decision.needsSync) {
      if (decision.assignSyncId && syncCols.member_analysis_sync_id) {
        sheet.getRange(rowNumber, syncCols.member_analysis_sync_id).setValue(decision.syncId);
      }
      candidates.push({ rowNumber: rowNumber, rowValues: rowValues, decision: decision });
    }
    if (candidates.length >= SYNC_MAX_ROWS_PER_RUN) break;
  }

  if (!candidates.length) {
    return { ok: true, message: 'nothing to sync', batches: 0, synced: 0, failed: 0 };
  }

  var endpoint = getScriptPropertyRequired_('MEMBER_ANALYSIS_SYNC_ENDPOINT');
  var secret = getScriptPropertyRequired_('MEMBER_ANALYSIS_SYNC_SECRET');

  var totalSynced = 0;
  var totalFailed = 0;
  var batches = 0;

  for (var start = 0; start < candidates.length; start += SYNC_BATCH_SIZE) {
    var chunk = candidates.slice(start, start + SYNC_BATCH_SIZE);
    var payload = buildSyncPayload_(chunk, headerMap);
    batches += 1;

    try {
      var response = UrlFetchApp.fetch(endpoint, {
        method: 'post',
        contentType: 'application/json',
        headers: { 'X-Member-Analysis-Secret': secret },
        payload: JSON.stringify(payload),
        muteHttpExceptions: true,
      });
      var code = response.getResponseCode();
      var bodyText = response.getContentText();
      var body = {};
      try { body = JSON.parse(bodyText); } catch (e) { body = { error: bodyText }; }

      if (code < 200 || code >= 300) {
        markBatchError_(sheet, chunk, syncCols, 'HTTP ' + code + ': ' + String(body.error || bodyText).slice(0, 200));
        totalFailed += chunk.length;
        continue;
      }

      applyBatchResults_(sheet, chunk, syncCols, body);
      totalSynced += Number(body.synced || 0);
      totalFailed += Number(body.failed || 0);
    } catch (err) {
      markBatchError_(sheet, chunk, syncCols, String(err.message || err).slice(0, 200));
      totalFailed += chunk.length;
    }
  }

  return {
    ok: totalFailed === 0,
    batches: batches,
    synced: totalSynced,
    failed: totalFailed,
    candidates: candidates.length,
    manual: !!options.manual,
  };
}

function getMemberAnalysisResponseSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('フォームの回答 1') || ss.getSheets()[0];
  return sheet;
}

function buildHeaderIndexMap_(sheet) {
  var lastCol = sheet.getLastColumn();
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var map = {};
  headers.forEach(function (h, idx) {
    var key = String(h || '').trim();
    if (key) map[key] = idx + 1;
  });
  return map;
}

function ensureSyncColumns_(sheet, headerMap) {
  var lastCol = sheet.getLastColumn();
  var missing = SYNC_COLUMN_HEADERS.filter(function (h) { return !headerMap[h]; });
  if (!missing.length) return;

  var startCol = lastCol + 1;
  sheet.getRange(1, startCol, 1, missing.length).setValues([missing]);
}

function getSyncColumnIndexes_(headerMap) {
  var out = {};
  SYNC_COLUMN_HEADERS.forEach(function (h) {
    out[h] = headerMap[h] || null;
  });
  return out;
}

function isRawExcludedHeader_(header) {
  return RAW_EXCLUDE_HEADERS.indexOf(String(header || '').trim()) >= 0;
}

/**
 * sync 対象判定:
 * sync_id なし OR status != synced OR hash 変更
 */
function evaluateSyncNeed_(rowValues, headerMap, syncCols) {
  var syncIdCol = syncCols.member_analysis_sync_id;
  var statusCol = syncCols.member_analysis_sync_status;
  var hashCol = syncCols.member_analysis_sync_hash;

  var syncId = syncIdCol ? String(rowValues[syncIdCol - 1] || '').trim() : '';
  var status = statusCol ? String(rowValues[statusCol - 1] || '').trim() : '';
  var storedHash = hashCol ? String(rowValues[hashCol - 1] || '').trim() : '';

  var responseMap = buildResponseMap_(rowValues, headerMap);
  var newHash = computeResponseHash_(responseMap);

  if (!syncId) {
    syncId = Utilities.getUuid();
    return { needsSync: true, syncId: syncId, newHash: newHash, reason: 'new', assignSyncId: true };
  }

  if (status !== SYNC_STATUS_SYNCED) {
    return {
      needsSync: true,
      syncId: syncId,
      newHash: newHash,
      reason: status === SYNC_STATUS_ERROR ? 'retry_error' : 'not_synced',
    };
  }

  if (storedHash && storedHash === newHash) {
    return { needsSync: false, syncId: syncId, newHash: newHash, reason: 'unchanged' };
  }

  return { needsSync: true, syncId: syncId, newHash: newHash, reason: 'changed' };
}

function buildResponseMap_(rowValues, headerMap) {
  var map = {};
  Object.keys(headerMap).forEach(function (header) {
    if (SYNC_COLUMN_HEADERS.indexOf(header) >= 0) return;
    if (isRawExcludedHeader_(header)) return;
    var col = headerMap[header];
    map[header] = normalizeCellValue_(rowValues[col - 1]);
  });
  return map;
}

function normalizeCellValue_(value) {
  if (value === null || value === undefined || value === '') return '';
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return Utilities.formatDate(value, Session.getScriptTimeZone() || 'Asia/Tokyo', "yyyy-MM-dd'T'HH:mm:ssXXX");
  }
  return value;
}

function computeResponseHash_(responseMap) {
  var keys = Object.keys(responseMap).sort();
  var canonical = {};
  keys.forEach(function (k) { canonical[k] = responseMap[k]; });
  var json = JSON.stringify(canonical);
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, json, Utilities.Charset.UTF_8);
  return digest.map(function (b) {
    var v = (b < 0 ? b + 256 : b).toString(16);
    return v.length === 1 ? '0' + v : v;
  }).join('');
}

function pickMetaValue_(responseMap, candidates) {
  for (var i = 0; i < candidates.length; i++) {
    var h = candidates[i];
    if (Object.prototype.hasOwnProperty.call(responseMap, h) && responseMap[h] !== '') {
      return { header: h, value: responseMap[h] };
    }
  }
  return { header: null, value: '' };
}

function buildSyncPayload_(chunk, headerMap) {
  var questionnaireVersion = getSyncQuestionnaireVersion_();
  var mappingRowsForItemAnswers = null;

  if (questionnaireVersion === QUESTIONNAIRE_VERSION_V3) {
    mappingRowsForItemAnswers = loadValidatedV3MappingRowsForSync_();
  }

  var responses = chunk.map(function (item) {
    var responseMap = buildResponseMap_(item.rowValues, headerMap);
    var ts = pickMetaValue_(responseMap, META_HEADERS.timestamp);
    var email = pickMetaValue_(responseMap, META_HEADERS.email);
    var name = pickMetaValue_(responseMap, META_HEADERS.name);

    var response = {
      source_response_id: item.decision.syncId,
      answered_at: ts.value,
      respondent_name: name.value || null,
      respondent_email: email.value || null,
      raw_answers: responseMap,
    };

    if (questionnaireVersion === QUESTIONNAIRE_VERSION_V3) {
      response.item_answers = buildItemAnswersFromMappingRows_(responseMap, mappingRowsForItemAnswers);
    }

    return response;
  });

  return {
    source: SYNC_SOURCE,
    questionnaire_version: questionnaireVersion,
    responses: responses,
  };
}

/**
 * v1 Production: Mapping Sheet なし → v1。
 * v3 Spreadsheet: 質問IDマッピングに v3 form_version がある → v3。
 */
function getSyncQuestionnaireVersion_() {
  if (typeof hasV3QuestionMappingSheet_ === 'function' && hasV3QuestionMappingSheet_()) {
    return QUESTIONNAIRE_VERSION_V3;
  }
  return QUESTIONNAIRE_VERSION;
}

/**
 * Phase 2: Mapping Sheet を検証し active 118 件を返す。異常時は throw（fail closed）。
 * @returns {Object[]}
 */
function loadValidatedV3MappingRowsForSync_() {
  var sheet = ensureMappingSheet_();
  var rows = readExistingMappingRows_(sheet);
  var active = rows.filter(function (row) {
    return String(row.active || '').toUpperCase() !== 'FALSE';
  });

  if (active.length !== 118) {
    throw new Error('v3 Mapping active rows: expected 118, got ' + active.length);
  }

  var itemIds = {};
  var emptyOrUnmapped = 0;
  active.forEach(function (row) {
    var id = String(row.item_id || '').trim();
    if (!id || id === 'UNMAPPED') {
      emptyOrUnmapped += 1;
      return;
    }
    itemIds[id] = (itemIds[id] || 0) + 1;
  });

  if (emptyOrUnmapped > 0) {
    throw new Error('v3 Mapping UNMAPPED/empty item_id: ' + emptyOrUnmapped);
  }
  if (Object.keys(itemIds).length !== 118) {
    throw new Error('v3 Mapping unique item_id: expected 118, got ' + Object.keys(itemIds).length);
  }
  Object.keys(itemIds).forEach(function (id) {
    if (itemIds[id] > 1) throw new Error('v3 Mapping duplicate item_id: ' + id);
  });

  return active;
}

/**
 * raw_answers（Sheet ヘッダー）→ item_answers（恒久 item_id）。
 * 意味的 fuzzy match はしない。構造的ヘッダー候補のみ。
 * @param {Object} responseMap
 * @param {Object[]} mappingRows
 * @returns {Object}
 */
function buildItemAnswersFromMappingRows_(responseMap, mappingRows) {
  var itemAnswers = {};
  var unresolved = [];

  mappingRows.forEach(function (row) {
    var itemId = String(row.item_id || '').trim();
    var candidates = candidateAnswerHeadersForMappingRow_(row);
    var header = resolveRawAnswerHeader_(responseMap, candidates);
    if (!header) {
      unresolved.push(itemId);
      return;
    }
    itemAnswers[itemId] = responseMap[header];
  });

  if (unresolved.length) {
    throw new Error(
      'v3 item_answers unresolved: ' + unresolved.length +
      ' (例: ' + unresolved.slice(0, 5).join(', ') + ')'
    );
  }
  if (Object.keys(itemAnswers).length !== 118) {
    throw new Error(
      'v3 item_answers count: expected 118, got ' + Object.keys(itemAnswers).length
    );
  }
  return itemAnswers;
}

/** @param {Object} row @returns {string[]} */
function candidateAnswerHeadersForMappingRow_(row) {
  var sourceHeader = String(row.source_header || '').trim();
  var rowLabel = String(row.row_label || '').trim();
  var rowIndex = row.row_index === null || row.row_index === undefined || row.row_index === ''
    ? ''
    : String(row.row_index);

  var titles = [];
  function pushTitle(t) {
    var v = String(t || '').trim();
    if (v && titles.indexOf(v) < 0) titles.push(v);
  }

  pushTitle(sourceHeader);
  pushTitle(collapseMappingWhitespace_(sourceHeader));
  pushTitle(firstMappingLine_(sourceHeader));
  pushTitle(collapseMappingWhitespace_(firstMappingLine_(sourceHeader)));

  if (rowIndex === '') return titles;

  var candidates = [];
  titles.forEach(function (title) {
    var bracketed = title + ' [' + rowLabel + ']';
    if (candidates.indexOf(bracketed) < 0) candidates.push(bracketed);
  });
  return candidates;
}

function firstMappingLine_(text) {
  return String(text || '').split(/\r?\n/)[0].trim();
}

function collapseMappingWhitespace_(text) {
  return String(text || '').replace(/[\u3000\s]+/g, ' ').trim();
}

/** @param {Object} responseMap @param {string[]} candidates @returns {string|null} */
function resolveRawAnswerHeader_(responseMap, candidates) {
  var i;
  for (i = 0; i < candidates.length; i++) {
    if (Object.prototype.hasOwnProperty.call(responseMap, candidates[i])) {
      return candidates[i];
    }
  }

  var collapsedToKey = {};
  Object.keys(responseMap || {}).forEach(function (key) {
    collapsedToKey[collapseMappingWhitespace_(key)] = key;
  });
  for (i = 0; i < candidates.length; i++) {
    var hit = collapsedToKey[collapseMappingWhitespace_(candidates[i])];
    if (hit) return hit;
  }
  return null;
}

function applyBatchResults_(sheet, chunk, syncCols, body) {
  var resultMap = {};
  (body.results || []).forEach(function (r) {
    if (r && r.source_response_id) resultMap[r.source_response_id] = r;
  });

  var now = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Asia/Tokyo', "yyyy-MM-dd'T'HH:mm:ssXXX");

  chunk.forEach(function (item) {
    var syncId = item.decision.syncId;
    var result = resultMap[syncId];
    var rowNumber = item.rowNumber;

    if (syncCols.member_analysis_sync_id) {
      sheet.getRange(rowNumber, syncCols.member_analysis_sync_id).setValue(syncId);
    }

    if (!result || result.status === 'failed') {
      writeSyncStatus_(sheet, rowNumber, syncCols, SYNC_STATUS_ERROR, item.decision.newHash, now,
        (result && result.error) ? result.error : 'sync failed');
      return;
    }

    writeSyncStatus_(sheet, rowNumber, syncCols, SYNC_STATUS_SYNCED, item.decision.newHash, now, '');
  });
}

function markBatchError_(sheet, chunk, syncCols, message) {
  var now = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Asia/Tokyo', "yyyy-MM-dd'T'HH:mm:ssXXX");
  chunk.forEach(function (item) {
    if (syncCols.member_analysis_sync_id) {
      sheet.getRange(item.rowNumber, syncCols.member_analysis_sync_id).setValue(item.decision.syncId);
    }
    writeSyncStatus_(sheet, item.rowNumber, syncCols, SYNC_STATUS_ERROR, item.decision.newHash, now, message);
  });
}

function writeSyncStatus_(sheet, rowNumber, syncCols, status, hash, syncedAt, errorMessage) {
  if (syncCols.member_analysis_sync_status) {
    sheet.getRange(rowNumber, syncCols.member_analysis_sync_status).setValue(status);
  }
  if (syncCols.member_analysis_synced_at) {
    sheet.getRange(rowNumber, syncCols.member_analysis_synced_at).setValue(syncedAt);
  }
  if (syncCols.member_analysis_sync_hash) {
    sheet.getRange(rowNumber, syncCols.member_analysis_sync_hash).setValue(hash);
  }
  if (syncCols.member_analysis_sync_error) {
    sheet.getRange(rowNumber, syncCols.member_analysis_sync_error).setValue(errorMessage || '');
  }
}

function getScriptPropertyRequired_(key) {
  var value = PropertiesService.getScriptProperties().getProperty(key);
  if (!value) throw new Error('Script Property missing: ' + key);
  return value;
}

function formatSyncResultSummary(result) {
  if (result.blocked) {
    return result.message || '同期は Phase 2 完了まで無効です。';
  }
  if (result.locked) {
    return '同期スキップ: 別の同期が実行中です';
  }
  return [
    result.ok ? '同期完了' : '同期完了（エラーあり）',
    '候補: ' + (result.candidates || 0),
    'batch: ' + (result.batches || 0),
    'synced: ' + (result.synced || 0),
    'failed: ' + (result.failed || 0),
  ].join('\n');
}

/**
 * v3 sync payload dry-run（read-only）。
 * 実回答 Sheet → raw_answers → item_answers → payload を構築するが、
 * POST / Sheet 書込 / sync 状態変更 / scoring は行わない。
 */
function previewMemberAnalysisV3SyncPayload() {
  var stats = buildMemberAnalysisV3SyncPayloadPreviewStats_();
  var summary = formatMemberAnalysisV3SyncPayloadPreviewSummary_(stats);
  Logger.log(summary);
  SpreadsheetApp.getUi().alert(summary);
  return stats;
}

/**
 * @returns {Object} 統計のみ（回答本文・PII は含めない）
 */
function buildMemberAnalysisV3SyncPayloadPreviewStats_() {
  var stats = {
    questionnaire_version: null,
    preview_row_number: null,
    raw_answers_key_count: 0,
    item_answers_key_count: 0,
    non_empty_item_answers_count: 0,
    empty_item_answers_count: 0,
    mapping_active_count: null,
    mapping_item_id_count: null,
    unresolved_mapping_count: 0,
    duplicate_item_id_count: 0,
    hash_source: 'legacy raw_answers',
    item_answers_included_in_hash: false,
    scoring_note: 'server-side v3 scoring (not invoked in preview)',
    validation: 'FAIL',
    validation_errors: [],
  };

  try {
    var qVersion = getSyncQuestionnaireVersion_();
    stats.questionnaire_version = qVersion;
    if (qVersion !== QUESTIONNAIRE_VERSION_V3) {
      stats.validation_errors.push('questionnaire_version is not ' + QUESTIONNAIRE_VERSION_V3);
      return stats;
    }

    var mappingRows;
    try {
      mappingRows = loadValidatedV3MappingRowsForSync_();
      stats.mapping_active_count = mappingRows.length;
      stats.mapping_item_id_count = mappingRows.length;
      stats.duplicate_item_id_count = 0;
    } catch (mapErr) {
      stats.validation_errors.push(String(mapErr.message || mapErr));
      return stats;
    }

    var sheet = getMemberAnalysisResponseSheet_();
    var headerMap = buildHeaderIndexMap_(sheet);
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      stats.validation_errors.push('回答行がありません');
      return stats;
    }

    var syncCols = getSyncColumnIndexes_(headerMap);
    var dataWidth = sheet.getLastColumn();
    var allRows = sheet.getRange(2, 1, lastRow - 1, dataWidth).getValues();

    var previewRow = selectPreviewResponseRowForSyncPayload_(allRows, headerMap);
    if (!previewRow) {
      stats.validation_errors.push('有効な回答行がありません（タイムスタンプ付き行なし）');
      return stats;
    }
    stats.preview_row_number = previewRow.rowNumber;

    var decision = buildPreviewSyncDecision_(previewRow.rowValues, headerMap, syncCols);
    var chunk = [{ rowNumber: previewRow.rowNumber, rowValues: previewRow.rowValues, decision: decision }];

    var payload;
    try {
      payload = buildSyncPayload_(chunk, headerMap);
    } catch (payloadErr) {
      var msg = String(payloadErr.message || payloadErr);
      stats.validation_errors.push(msg);
      var unresolvedMatch = msg.match(/unresolved:\s*(\d+)/);
      if (unresolvedMatch) {
        stats.unresolved_mapping_count = Number(unresolvedMatch[1]);
      }
      return stats;
    }

    var response = payload.responses[0];
    var rawAnswers = response.raw_answers || {};
    var itemAnswers = response.item_answers || {};

    stats.raw_answers_key_count = Object.keys(rawAnswers).length;
    stats.item_answers_key_count = Object.keys(itemAnswers).length;
    Object.keys(itemAnswers).forEach(function (id) {
      var v = itemAnswers[id];
      if (v === null || v === undefined || v === '') {
        stats.empty_item_answers_count += 1;
      } else {
        stats.non_empty_item_answers_count += 1;
      }
    });

    if (stats.mapping_active_count !== 118) {
      stats.validation_errors.push('mapping active count: expected 118, got ' + stats.mapping_active_count);
    }
    if (stats.mapping_item_id_count !== 118) {
      stats.validation_errors.push('mapping item_id count: expected 118, got ' + stats.mapping_item_id_count);
    }
    if (stats.item_answers_key_count !== 118) {
      stats.validation_errors.push('item_answers key count: expected 118, got ' + stats.item_answers_key_count);
    }
    if (stats.unresolved_mapping_count !== 0) {
      stats.validation_errors.push('unresolved mapping count: expected 0, got ' + stats.unresolved_mapping_count);
    }

    stats.validation = stats.validation_errors.length ? 'FAIL' : 'PASS';
    return stats;
  } catch (err) {
    stats.validation_errors.push(String(err.message || err));
    return stats;
  }
}

/**
 * プレビュー対象行: 最下行から走査し、タイムスタンプ付きの最新回答 1 件。
 * @returns {{ rowNumber: number, rowValues: *[] }|null}
 */
function selectPreviewResponseRowForSyncPayload_(allRows, headerMap) {
  for (var i = allRows.length - 1; i >= 0; i--) {
    var rowValues = allRows[i];
    var responseMap = buildResponseMap_(rowValues, headerMap);
    var ts = pickMetaValue_(responseMap, META_HEADERS.timestamp);
    if (ts.value) {
      return { rowNumber: i + 2, rowValues: rowValues };
    }
  }
  return null;
}

/** プレビュー専用 sync decision（Sheet へ sync_id を書き込まない） */
function buildPreviewSyncDecision_(rowValues, headerMap, syncCols) {
  var syncIdCol = syncCols.member_analysis_sync_id;
  var syncId = syncIdCol ? String(rowValues[syncIdCol - 1] || '').trim() : '';
  if (!syncId) {
    syncId = 'preview-' + Utilities.getUuid();
  }
  var responseMap = buildResponseMap_(rowValues, headerMap);
  var newHash = computeResponseHash_(responseMap);
  return {
    needsSync: true,
    syncId: syncId,
    newHash: newHash,
    reason: 'preview',
    assignSyncId: false,
  };
}

function formatMemberAnalysisV3SyncPayloadPreviewSummary_(stats) {
  var lines = [
    'v3 Sync Payload プレビュー（dry-run / read-only）',
    'preview_row: ' + (stats.preview_row_number != null ? stats.preview_row_number : '—'),
    'questionnaire_version: ' + (stats.questionnaire_version || '—'),
    'raw_answers key count: ' + stats.raw_answers_key_count,
    'item_answers key count: ' + stats.item_answers_key_count,
    'non-empty item_answers count: ' + stats.non_empty_item_answers_count,
    'empty item_answers count: ' + stats.empty_item_answers_count,
    'mapping active count: ' + (stats.mapping_active_count != null ? stats.mapping_active_count : '—'),
    'mapping item_id count: ' + (stats.mapping_item_id_count != null ? stats.mapping_item_id_count : '—'),
    'unresolved mapping count: ' + stats.unresolved_mapping_count,
    'duplicate item_id count: ' + stats.duplicate_item_id_count,
    'hash source: ' + stats.hash_source,
    'item_answers included in hash: ' + stats.item_answers_included_in_hash,
    'scoring: ' + stats.scoring_note,
    'validation: ' + stats.validation,
  ];
  if (stats.validation_errors.length) {
    lines.push('errors:');
    stats.validation_errors.forEach(function (e) { lines.push('  - ' + e); });
  }
  return lines.join('\n');
}
