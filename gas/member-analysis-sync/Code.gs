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

/** Phase 5A: 収集年度の正本（Form title / 現在日時から推定しない） */
var ACADEMIC_YEAR_PROPERTY = 'MEMBER_ANALYSIS_ACADEMIC_YEAR';
var ACADEMIC_YEAR_MIN = 2000;
var ACADEMIC_YEAR_MAX = 2100;

/** Phase 5B: 募集 lifecycle（業務状態 — sync payload / DB には含めない） */
var COLLECTION_STATE_PROPERTY = 'MEMBER_ANALYSIS_COLLECTION_STATE';
var COLLECTION_STATES = ['preparing', 'open', 'closed'];
var EXPECTED_V3_MAPPING_ACTIVE_COUNT = 118;

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
    .addItem('v3 Sync Hash 監査（開発）', 'previewMemberAnalysisV3SyncHashMigration')
    .addItem('年度設定プレビュー（開発）', 'previewMemberAnalysisAnnualConfig')
    .addItem('年度Formライフサイクル監査（開発）', 'previewMemberAnalysisFormLifecycle')
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
    'pending/その他: ' + counts.pending + '\n' +
    formatAcademicYearStatusLine_()
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

  if (getSyncQuestionnaireVersion_() === QUESTIONNAIRE_VERSION_V3) {
    var yearCheck = getMemberAnalysisAcademicYearRequired_();
    if (!yearCheck.ok) {
      return {
        ok: false,
        message: yearCheck.error,
        batches: 0,
        synced: 0,
        failed: 0,
        manual: !!(options && options.manual),
      };
    }
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

  var mappingRowsForHash = null;
  if (getSyncQuestionnaireVersion_() === QUESTIONNAIRE_VERSION_V3) {
    mappingRowsForHash = loadValidatedV3MappingRowsForSync_();
  }

  var candidates = [];
  for (var i = 0; i < allRows.length; i++) {
    var rowNumber = i + 2;
    var rowValues = allRows[i];
    var decision = evaluateSyncNeed_(rowValues, headerMap, syncCols, mappingRowsForHash);
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
 * v3: legacy dual-read + stable item-ID hash write (itemid-v1:)
 * @param {*[]} rowValues
 * @param {Object} headerMap
 * @param {Object} syncCols
 * @param {Object[]|null} mappingRowsForHash v3 のみ（118 active rows）
 */
function evaluateSyncNeed_(rowValues, headerMap, syncCols, mappingRowsForHash) {
  var syncIdCol = syncCols.member_analysis_sync_id;
  var statusCol = syncCols.member_analysis_sync_status;
  var hashCol = syncCols.member_analysis_sync_hash;

  var syncId = syncIdCol ? String(rowValues[syncIdCol - 1] || '').trim() : '';
  var status = statusCol ? String(rowValues[statusCol - 1] || '').trim() : '';
  var storedHash = hashCol ? String(rowValues[hashCol - 1] || '').trim() : '';

  var responseMap = buildResponseMap_(rowValues, headerMap);
  var legacyHash = computeResponseHash_(responseMap);

  if (getSyncQuestionnaireVersion_() === QUESTIONNAIRE_VERSION_V3) {
    if (!mappingRowsForHash) {
      throw new Error('v3 hash evaluation requires mapping rows');
    }
    var itemAnswers = buildItemAnswersFromMappingRows_(responseMap, mappingRowsForHash);
    var stableHash = computeStableV3ResponseHash_(QUESTIONNAIRE_VERSION_V3, mappingRowsForHash, itemAnswers);
    return evaluateSyncNeedV3_(syncId, status, storedHash, legacyHash, stableHash);
  }

  if (!syncId) {
    syncId = Utilities.getUuid();
    return { needsSync: true, syncId: syncId, newHash: legacyHash, reason: 'new', assignSyncId: true };
  }

  if (status !== SYNC_STATUS_SYNCED) {
    return {
      needsSync: true,
      syncId: syncId,
      newHash: legacyHash,
      reason: status === SYNC_STATUS_ERROR ? 'retry_error' : 'not_synced',
    };
  }

  if (storedHash && storedHash === legacyHash) {
    return { needsSync: false, syncId: syncId, newHash: legacyHash, reason: 'unchanged' };
  }

  return { needsSync: true, syncId: syncId, newHash: legacyHash, reason: 'changed' };
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
  var academicYear = null;

  if (questionnaireVersion === QUESTIONNAIRE_VERSION_V3) {
    var yearResult = getMemberAnalysisAcademicYearRequired_();
    if (!yearResult.ok) {
      throw new Error(yearResult.error);
    }
    academicYear = yearResult.value;
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
      response.academic_year = academicYear;
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

/**
 * Phase 5A: Script Property から academic_year を取得（v3 sync 必須）。
 * @returns {{ ok: true, value: number } | { ok: false, error: string }}
 */
function getMemberAnalysisAcademicYearRequired_() {
  var raw = PropertiesService.getScriptProperties().getProperty(ACADEMIC_YEAR_PROPERTY);
  return parseMemberAnalysisAcademicYear_(raw, { required: true });
}

/**
 * Phase 5A: preview 用 — 未設定でも throw しない。
 * @returns {{ ok: true, value: number|null } | { ok: false, error: string }}
 */
function getMemberAnalysisAcademicYearOptional_() {
  var raw = PropertiesService.getScriptProperties().getProperty(ACADEMIC_YEAR_PROPERTY);
  return parseMemberAnalysisAcademicYear_(raw, { required: false });
}

/**
 * @param {string|null|undefined} raw
 * @param {{ required?: boolean }} options
 * @returns {{ ok: true, value: number|null } | { ok: false, error: string }}
 */
function parseMemberAnalysisAcademicYear_(raw, options) {
  options = options || {};
  if (raw === null || raw === undefined || String(raw).trim() === '') {
    if (options.required) {
      return { ok: false, error: 'Script Property missing: ' + ACADEMIC_YEAR_PROPERTY };
    }
    return { ok: true, value: null };
  }

  var trimmed = String(raw).trim();
  if (!/^\d{4}$/.test(trimmed)) {
    return { ok: false, error: 'academic_year must be a 4-digit integer' };
  }

  var n = Number(trimmed);
  if (!Number.isInteger(n) || n < ACADEMIC_YEAR_MIN || n > ACADEMIC_YEAR_MAX) {
    return {
      ok: false,
      error: 'academic_year out of range: ' + ACADEMIC_YEAR_MIN + '–' + ACADEMIC_YEAR_MAX,
    };
  }

  return { ok: true, value: n };
}

/** @returns {string} */
function formatAcademicYearStatusLine_() {
  var yearResult = getMemberAnalysisAcademicYearOptional_();
  if (!yearResult.ok) {
    return 'academic_year: INVALID (' + yearResult.error + ')';
  }
  if (yearResult.value == null) {
    return 'academic_year: (未設定 — ' + ACADEMIC_YEAR_PROPERTY + ')';
  }
  return 'academic_year: ' + yearResult.value;
}

/**
 * Phase 5B: collection_state 解析（strict lowercase）。
 * @param {string|null|undefined} raw
 * @returns {{ ok: boolean, value: (string|null), display: string, error: string }}
 */
function parseMemberAnalysisCollectionState_(raw) {
  if (raw === null || raw === undefined || String(raw).trim() === '') {
    return {
      ok: false,
      value: null,
      display: 'MISSING',
      error: COLLECTION_STATE_PROPERTY + ' is not configured',
    };
  }
  var trimmed = String(raw).trim();
  if (trimmed !== trimmed.toLowerCase()) {
    return {
      ok: false,
      value: null,
      display: trimmed,
      error: 'collection_state must be lowercase: preparing|open|closed',
    };
  }
  if (COLLECTION_STATES.indexOf(trimmed) < 0) {
    return {
      ok: false,
      value: null,
      display: trimmed,
      error: 'unsupported collection_state: ' + trimmed,
    };
  }
  return { ok: true, value: trimmed, display: trimmed, error: '' };
}

/** @returns {{ ok: boolean, value: (string|null), display: string, error: string }} */
function getMemberAnalysisCollectionStateOptional_() {
  var raw = PropertiesService.getScriptProperties().getProperty(COLLECTION_STATE_PROPERTY);
  return parseMemberAnalysisCollectionState_(raw);
}

/**
 * Phase 5B: Form 設定 read-only 取得（mutation 禁止）。
 * @param {GoogleAppsScript.Forms.Form} form
 * @returns {Object}
 */
function readMemberAnalysisFormLifecycleSettings_(form) {
  var settings = {
    accepting_responses: null,
    limit_one_response_per_user: null,
    allow_response_edits: null,
    collects_email: null,
    is_published: null,
    has_respond_again_link: null,
  };

  if (!form) return settings;

  try { settings.accepting_responses = form.isAcceptingResponses(); } catch (e) { /* read-only */ }
  try { settings.limit_one_response_per_user = form.hasLimitOneResponsePerUser(); } catch (e) { /* read-only */ }
  try { settings.allow_response_edits = form.canEditResponse(); } catch (e) { /* read-only */ }
  try { settings.collects_email = form.collectsEmail(); } catch (e) { /* read-only */ }
  try {
    if (typeof form.isPublished === 'function') {
      settings.is_published = form.isPublished();
    }
  } catch (e) { /* optional */ }
  try {
    if (typeof form.hasRespondAgainLink === 'function') {
      settings.has_respond_again_link = form.hasRespondAgainLink();
    }
  } catch (e) { /* optional */ }

  return settings;
}

/**
 * Phase 5B lifecycle 判定 — lib/member-analysis-form-lifecycle.js と同仕様。
 * @param {Object} input
 * @returns {Object}
 */
function evaluateMemberAnalysisFormLifecycle_(input) {
  var warnings = [];
  var info = [];
  var errors = [];

  if (!input.collectionStateOk || !input.collectionState) {
    errors.push(input.collectionStateError || (COLLECTION_STATE_PROPERTY + ' is not configured'));
    return {
      validation: 'FAIL',
      reason: errors[0],
      warnings: warnings,
      info: info,
      errors: errors,
    };
  }

  if (!input.academicYearValid) {
    errors.push('academic_year invalid or missing');
  }
  if (input.formIdValid === false) {
    errors.push('MEMBER_ANALYSIS_FORM_ID invalid or missing');
  }
  if (input.mappingActiveCount !== EXPECTED_V3_MAPPING_ACTIVE_COUNT) {
    errors.push(
      'mapping active count: expected ' + EXPECTED_V3_MAPPING_ACTIVE_COUNT +
      ', got ' + (input.mappingActiveCount == null ? 'null' : input.mappingActiveCount)
    );
  }

  var state = input.collectionState;

  if (state === 'preparing') {
    if (input.acceptingResponses === true) {
      warnings.push('preparing: accepting responses is true (recommended: false)');
    }
    if (input.syncEnabled === true) {
      warnings.push('preparing: sync enabled is true (recommended: false)');
    }
  }

  if (state === 'open') {
    if (input.acceptingResponses !== true) {
      errors.push('accepting responses must be true');
    }
    if (input.limitOneResponsePerUser !== true) {
      if (errors.indexOf('limit one response per user must be true') < 0) {
        errors.push('limit one response per user must be true');
      }
      return {
        validation: 'FAIL',
        reason: 'multiple_new_responses_allowed',
        warnings: warnings,
        info: info,
        errors: errors,
      };
    }
    if (input.allowResponseEdits !== true) {
      if (errors.indexOf('allow response edits must be true') < 0) {
        errors.push('allow response edits must be true');
      }
      return {
        validation: 'FAIL',
        reason: 'response_editing_disabled',
        warnings: warnings,
        info: info,
        errors: errors,
      };
    }
    if (input.syncEnabled === false) {
      warnings.push('collection is open but sync is disabled');
    }
  }

  if (state === 'closed') {
    if (input.acceptingResponses !== false) {
      errors.push('accepting responses must be false');
    }
    if (input.allowResponseEdits === true) {
      info.push('allow response edits: true (Form API; edit URL behavior may vary after close)');
    } else if (input.allowResponseEdits === false) {
      info.push('allow response edits: false');
    }
  }

  if (input.collectsEmail === false) {
    info.push('email collection: OFF');
    info.push('identity matching improvement: pending Phase 5D');
  } else if (input.collectsEmail === true) {
    info.push('email collection: ON');
  }

  if (errors.length) {
    return {
      validation: 'FAIL',
      reason: errors[0],
      warnings: warnings,
      info: info,
      errors: errors,
    };
  }

  return {
    validation: 'PASS',
    reason: null,
    warnings: warnings,
    info: info,
    errors: errors,
  };
}

/** @param {boolean|null|undefined} value @returns {string} */
function formatLifecycleBool_(value) {
  if (value === null || value === undefined) return '—';
  return value ? 'true' : 'false';
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
    academic_year: null,
    preview_row_number: null,
    raw_answers_key_count: 0,
    item_answers_key_count: 0,
    non_empty_item_answers_count: 0,
    empty_item_answers_count: 0,
    mapping_active_count: null,
    mapping_item_id_count: null,
    unresolved_mapping_count: 0,
    duplicate_item_id_count: 0,
    hash_source: 'itemid-v1 stable (dual-read legacy compatible)',
    item_answers_included_in_hash: true,
    hash_mode: null,
    stored_hash_format: null,
    legacy_compatible: null,
    would_sync: null,
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

    var yearResult = getMemberAnalysisAcademicYearOptional_();
    if (!yearResult.ok) {
      stats.validation_errors.push(yearResult.error);
    } else {
      stats.academic_year = yearResult.value;
      if (yearResult.value == null) {
        stats.validation_errors.push('Script Property missing: ' + ACADEMIC_YEAR_PROPERTY);
      }
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

    var decision = buildPreviewSyncDecision_(previewRow.rowValues, headerMap, syncCols, mappingRows);
    stats.hash_mode = 'itemid-v1';
    stats.stored_hash_format = decision.hashFormat || '—';
    stats.legacy_compatible = decision.legacyCompatible ? 'yes' : 'no';
    stats.would_sync = decision.needsSync ? 'yes' : 'no';
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
    if (response.academic_year != null) {
      stats.academic_year = response.academic_year;
    }
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
function buildPreviewSyncDecision_(rowValues, headerMap, syncCols, mappingRows) {
  var syncIdCol = syncCols.member_analysis_sync_id;
  var syncId = syncIdCol ? String(rowValues[syncIdCol - 1] || '').trim() : '';
  if (!syncId) {
    syncId = 'preview-' + Utilities.getUuid();
  }
  var responseMap = buildResponseMap_(rowValues, headerMap);
  var legacyHash = computeResponseHash_(responseMap);

  if (getSyncQuestionnaireVersion_() === QUESTIONNAIRE_VERSION_V3 && mappingRows) {
    try {
      var itemAnswers = buildItemAnswersFromMappingRows_(responseMap, mappingRows);
      var stableHash = computeStableV3ResponseHash_(QUESTIONNAIRE_VERSION_V3, mappingRows, itemAnswers);
      var statusCol = syncCols.member_analysis_sync_status;
      var hashCol = syncCols.member_analysis_sync_hash;
      var status = statusCol ? String(rowValues[statusCol - 1] || '').trim() : '';
      var storedHash = hashCol ? String(rowValues[hashCol - 1] || '').trim() : '';
      var decision = evaluateSyncNeedV3_(syncId, status, storedHash, legacyHash, stableHash);
      decision.assignSyncId = false;
      return decision;
    } catch (previewHashErr) {
      return {
        needsSync: true,
        syncId: syncId,
        newHash: legacyHash,
        legacyHash: legacyHash,
        stableHash: '',
        reason: 'preview_hash_error',
        assignSyncId: false,
        hashFormat: 'error',
      };
    }
  }

  return {
    needsSync: true,
    syncId: syncId,
    newHash: legacyHash,
    reason: 'preview',
    assignSyncId: false,
  };
}

function formatMemberAnalysisV3SyncPayloadPreviewSummary_(stats) {
  var lines = [
    'v3 Sync Payload プレビュー（dry-run / read-only）',
    'preview_row: ' + (stats.preview_row_number != null ? stats.preview_row_number : '—'),
    'questionnaire_version: ' + (stats.questionnaire_version || '—'),
    'academic_year: ' + (stats.academic_year != null ? stats.academic_year : '—'),
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
    'hash mode: ' + (stats.hash_mode || '—'),
    'stored hash format: ' + (stats.stored_hash_format || '—'),
    'legacy compatible: ' + (stats.legacy_compatible || '—'),
    'would sync: ' + (stats.would_sync || '—'),
    'scoring: ' + stats.scoring_note,
    'validation: ' + stats.validation,
  ];
  if (stats.validation_errors.length) {
    lines.push('errors:');
    stats.validation_errors.forEach(function (e) { lines.push('  - ' + e); });
  }
  return lines.join('\n');
}

/**
 * Phase 5A: 年度設定 diagnostic（read-only）。
 * 回答本文・氏名・メールは出力しない。
 */
function previewMemberAnalysisAnnualConfig() {
  var stats = buildMemberAnalysisAnnualConfigStats_();
  var summary = formatMemberAnalysisAnnualConfigSummary_(stats);
  Logger.log(summary);
  SpreadsheetApp.getUi().alert(summary);
  return stats;
}

/** @returns {Object} */
function buildMemberAnalysisAnnualConfigStats_() {
  var stats = {
    form_title: null,
    form_version: null,
    questionnaire_version: null,
    academic_year: null,
    collection_state: null,
    mapping_active_count: null,
    sync_enabled: null,
    validation: 'FAIL',
    validation_errors: [],
  };

  try {
    stats.questionnaire_version = getSyncQuestionnaireVersion_();

    var yearResult = getMemberAnalysisAcademicYearOptional_();
    if (!yearResult.ok) {
      stats.validation_errors.push(yearResult.error);
    } else {
      stats.academic_year = yearResult.value;
      if (yearResult.value == null) {
        stats.validation_errors.push('Script Property missing: ' + ACADEMIC_YEAR_PROPERTY);
      }
    }

    var props = PropertiesService.getScriptProperties();
    var syncEnabledRaw = String(props.getProperty('MEMBER_ANALYSIS_SYNC_ENABLED') || '').trim().toLowerCase();
    stats.sync_enabled = (syncEnabledRaw === 'true' || syncEnabledRaw === '1') ? 'true' : 'false';

    var collectionResult = getMemberAnalysisCollectionStateOptional_();
    stats.collection_state = collectionResult.display;

    if (stats.questionnaire_version === QUESTIONNAIRE_VERSION_V3) {
      stats.form_version = QUESTIONNAIRE_VERSION_V3;
      try {
        var mappingRows = loadValidatedV3MappingRowsForSync_();
        stats.mapping_active_count = mappingRows.length;
      } catch (mapErr) {
        stats.validation_errors.push(String(mapErr.message || mapErr));
      }

      try {
        var formId = props.getProperty('MEMBER_ANALYSIS_FORM_ID');
        if (formId) {
          var form = FormApp.openById(formId);
          stats.form_title = form.getTitle();
        } else {
          stats.validation_errors.push('Script Property missing: MEMBER_ANALYSIS_FORM_ID');
        }
      } catch (formErr) {
        stats.validation_errors.push('Form open failed: ' + String(formErr.message || formErr).slice(0, 80));
      }
    } else {
      stats.form_version = QUESTIONNAIRE_VERSION;
    }

    stats.validation = stats.validation_errors.length ? 'FAIL' : 'PASS';
    return stats;
  } catch (err) {
    stats.validation_errors.push(String(err.message || err));
    return stats;
  }
}

function formatMemberAnalysisAnnualConfigSummary_(stats) {
  var lines = [
    '年度設定プレビュー（read-only）',
    'form title: ' + (stats.form_title || '—'),
    'form_version: ' + (stats.form_version || '—'),
    'questionnaire_version: ' + (stats.questionnaire_version || '—'),
    'academic_year: ' + (stats.academic_year != null ? stats.academic_year : '—'),
    'collection_state: ' + (stats.collection_state || '—'),
    'mapping active count: ' + (stats.mapping_active_count != null ? stats.mapping_active_count : '—'),
    'sync enabled: ' + (stats.sync_enabled || '—'),
    'validation: ' + stats.validation,
  ];
  if (stats.validation_errors.length) {
    lines.push('errors:');
    stats.validation_errors.forEach(function (e) { lines.push('  - ' + e); });
  }
  return lines.join('\n');
}

/**
 * Phase 5B: 年度 Form lifecycle 監査（read-only）。
 * Form / Sheet / Script Properties / DB を変更しない。
 */
function previewMemberAnalysisFormLifecycle() {
  var stats = buildMemberAnalysisFormLifecycleStats_();
  var summary = formatMemberAnalysisFormLifecycleSummary_(stats);
  Logger.log(summary);
  SpreadsheetApp.getUi().alert(summary);
  return stats;
}

/** @returns {Object} */
function buildMemberAnalysisFormLifecycleStats_() {
  var stats = {
    form_title: null,
    questionnaire_version: null,
    academic_year: null,
    collection_state: null,
    accepting_responses: null,
    limit_one_response_per_user: null,
    allow_response_edits: null,
    collects_email: null,
    is_published: null,
    has_respond_again_link: null,
    mapping_active_count: null,
    sync_enabled: null,
    warnings: [],
    info: [],
    validation: 'FAIL',
    reason: null,
    validation_errors: [],
  };

  try {
    stats.questionnaire_version = getSyncQuestionnaireVersion_();

    var yearResult = getMemberAnalysisAcademicYearOptional_();
    var academicYearValid = yearResult.ok && yearResult.value != null;
    stats.academic_year = yearResult.ok ? yearResult.value : null;
    if (!academicYearValid) {
      stats.validation_errors.push(yearResult.error || ('Script Property missing: ' + ACADEMIC_YEAR_PROPERTY));
    }

    var collectionResult = getMemberAnalysisCollectionStateOptional_();
    stats.collection_state = collectionResult.display;

    var props = PropertiesService.getScriptProperties();
    var syncEnabledRaw = String(props.getProperty('MEMBER_ANALYSIS_SYNC_ENABLED') || '').trim().toLowerCase();
    stats.sync_enabled = (syncEnabledRaw === 'true' || syncEnabledRaw === '1') ? 'true' : 'false';
    var syncEnabledBool = stats.sync_enabled === 'true';

    var formIdValid = false;
    var formSettings = readMemberAnalysisFormLifecycleSettings_(null);

    if (stats.questionnaire_version === QUESTIONNAIRE_VERSION_V3) {
      try {
        var mappingRows = loadValidatedV3MappingRowsForSync_();
        stats.mapping_active_count = mappingRows.length;
      } catch (mapErr) {
        stats.validation_errors.push(String(mapErr.message || mapErr));
      }

      try {
        var formId = props.getProperty('MEMBER_ANALYSIS_FORM_ID');
        if (formId) {
          var form = FormApp.openById(formId);
          formIdValid = true;
          stats.form_title = form.getTitle();
          formSettings = readMemberAnalysisFormLifecycleSettings_(form);
        } else {
          stats.validation_errors.push('Script Property missing: MEMBER_ANALYSIS_FORM_ID');
        }
      } catch (formErr) {
        stats.validation_errors.push('Form open failed: ' + String(formErr.message || formErr).slice(0, 80));
      }
    } else {
      stats.validation_errors.push('lifecycle audit requires v3 Spreadsheet');
    }

    stats.accepting_responses = formSettings.accepting_responses;
    stats.limit_one_response_per_user = formSettings.limit_one_response_per_user;
    stats.allow_response_edits = formSettings.allow_response_edits;
    stats.collects_email = formSettings.collects_email;
    stats.is_published = formSettings.is_published;
    stats.has_respond_again_link = formSettings.has_respond_again_link;

    var lifecycle = evaluateMemberAnalysisFormLifecycle_({
      collectionState: collectionResult.value,
      collectionStateOk: collectionResult.ok,
      collectionStateError: collectionResult.error,
      academicYearValid: academicYearValid,
      formIdValid: formIdValid,
      mappingActiveCount: stats.mapping_active_count,
      acceptingResponses: stats.accepting_responses,
      limitOneResponsePerUser: stats.limit_one_response_per_user,
      allowResponseEdits: stats.allow_response_edits,
      collectsEmail: stats.collects_email,
      syncEnabled: syncEnabledBool,
    });

    stats.warnings = lifecycle.warnings || [];
    stats.info = lifecycle.info || [];
    stats.validation = lifecycle.validation;
    stats.reason = lifecycle.reason;

    if (lifecycle.errors && lifecycle.errors.length) {
      lifecycle.errors.forEach(function (e) {
        if (stats.validation_errors.indexOf(e) < 0) stats.validation_errors.push(e);
      });
    }

    return stats;
  } catch (err) {
    stats.validation_errors.push(String(err.message || err));
    stats.reason = stats.validation_errors[0] || null;
    return stats;
  }
}

function formatMemberAnalysisFormLifecycleSummary_(stats) {
  var lines = [
    '年度Formライフサイクル監査（read-only）',
    '',
    'form title: ' + (stats.form_title || '—'),
    'questionnaire_version: ' + (stats.questionnaire_version || '—'),
    'academic_year: ' + (stats.academic_year != null ? stats.academic_year : '—'),
    'collection_state: ' + (stats.collection_state || '—'),
    '',
    'accepting responses: ' + formatLifecycleBool_(stats.accepting_responses),
    'limit one response per user: ' + formatLifecycleBool_(stats.limit_one_response_per_user),
    'allow response edits: ' + formatLifecycleBool_(stats.allow_response_edits),
    'collects email: ' + formatLifecycleBool_(stats.collects_email),
  ];

  if (stats.is_published != null) {
    lines.push('is published: ' + formatLifecycleBool_(stats.is_published));
  }
  if (stats.has_respond_again_link != null) {
    lines.push('has respond again link: ' + formatLifecycleBool_(stats.has_respond_again_link));
  }

  lines.push(
    '',
    'mapping active: ' + (stats.mapping_active_count != null ? stats.mapping_active_count : '—'),
    'sync enabled: ' + (stats.sync_enabled || '—'),
  );

  if (stats.warnings && stats.warnings.length) {
    lines.push('', 'warnings:');
    stats.warnings.forEach(function (w) { lines.push('- ' + w); });
  }
  if (stats.info && stats.info.length) {
    lines.push('', 'info:');
    stats.info.forEach(function (i) { lines.push('- ' + i); });
  }

  lines.push('', 'validation: ' + stats.validation);
  if (stats.reason) {
    lines.push('reason: ' + stats.reason);
  }
  if (stats.validation_errors.length) {
    lines.push('errors:');
    stats.validation_errors.forEach(function (e) { lines.push('  - ' + e); });
  }

  return lines.join('\n');
}

/**
 * v3 sync hash migration 監査（read-only）。
 * legacy / stable hash 分類と would_sync 件数のみ。PII・hash全文は出力しない。
 */
function previewMemberAnalysisV3SyncHashMigration() {
  var stats = buildMemberAnalysisV3SyncHashAuditStats_();
  var summary = formatMemberAnalysisV3SyncHashAuditSummary_(stats);
  Logger.log(summary);
  SpreadsheetApp.getUi().alert(summary);
  return stats;
}

/** @returns {Object} */
function buildMemberAnalysisV3SyncHashAuditStats_() {
  var stats = {
    questionnaire_version: null,
    response_rows: 0,
    synced_rows: 0,
    error_rows: 0,
    pending_rows: 0,
    stable_hash_rows: 0,
    legacy_compatible_rows: 0,
    legacy_mismatch_rows: 0,
    missing_hash_rows: 0,
    would_sync_rows: 0,
    row_details: [],
    validation: 'FAIL',
    validation_errors: [],
  };

  try {
    if (getSyncQuestionnaireVersion_() !== QUESTIONNAIRE_VERSION_V3) {
      stats.validation_errors.push('v3 Spreadsheet ではありません');
      return stats;
    }

    stats.questionnaire_version = QUESTIONNAIRE_VERSION_V3;
    var mappingRows = loadValidatedV3MappingRowsForSync_();
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
    stats.response_rows = allRows.length;

    for (var i = 0; i < allRows.length; i++) {
      var rowNumber = i + 2;
      var rowValues = allRows[i];
      var statusCol = syncCols.member_analysis_sync_status;
      var hashCol = syncCols.member_analysis_sync_hash;
      var status = statusCol ? String(rowValues[statusCol - 1] || '').trim() : '';
      var storedHash = hashCol ? String(rowValues[hashCol - 1] || '').trim() : '';

      if (status === SYNC_STATUS_SYNCED) stats.synced_rows += 1;
      else if (status === SYNC_STATUS_ERROR) stats.error_rows += 1;
      else stats.pending_rows += 1;

      var rowDetail = {
        row_number: rowNumber,
        status: status || '(empty)',
        hash_format: 'unknown',
        would_sync: false,
        reason: '',
      };

      try {
        var decision = evaluateSyncNeed_(rowValues, headerMap, syncCols, mappingRows);
        rowDetail.would_sync = decision.needsSync;
        rowDetail.reason = decision.reason || '';

        var legacyHash = decision.legacyHash || '';
        var stableHash = decision.stableHash || '';

        if (!storedHash) {
          stats.missing_hash_rows += 1;
          rowDetail.hash_format = 'missing';
        } else if (isStableV3StoredHash_(storedHash)) {
          stats.stable_hash_rows += 1;
          rowDetail.hash_format = 'stable';
        } else if (storedHash === legacyHash) {
          stats.legacy_compatible_rows += 1;
          rowDetail.hash_format = 'legacy_compatible';
        } else {
          stats.legacy_mismatch_rows += 1;
          rowDetail.hash_format = 'legacy_mismatch';
        }

        if (decision.needsSync) stats.would_sync_rows += 1;
      } catch (rowErr) {
        rowDetail.hash_format = 'error';
        rowDetail.reason = String(rowErr.message || rowErr).slice(0, 80);
        stats.would_sync_rows += 1;
      }

      stats.row_details.push(rowDetail);
    }

    stats.validation = stats.validation_errors.length ? 'FAIL' : 'PASS';
    return stats;
  } catch (err) {
    stats.validation_errors.push(String(err.message || err));
    return stats;
  }
}

/** @param {ReturnType<typeof buildMemberAnalysisV3SyncHashAuditStats_>} stats */
function formatMemberAnalysisV3SyncHashAuditSummary_(stats) {
  var lines = [
    'v3 Sync Hash 監査（read-only）',
    'questionnaire_version: ' + (stats.questionnaire_version || '—'),
    'response rows: ' + stats.response_rows,
    'synced: ' + stats.synced_rows,
    'error: ' + stats.error_rows,
    'pending/その他: ' + stats.pending_rows,
    '',
    'stable hash rows: ' + stats.stable_hash_rows,
    'legacy compatible rows: ' + stats.legacy_compatible_rows,
    'legacy mismatch rows: ' + stats.legacy_mismatch_rows,
    'missing hash rows: ' + stats.missing_hash_rows,
    'would sync rows: ' + stats.would_sync_rows,
    '',
    'row details (no PII):',
  ];

  (stats.row_details || []).forEach(function (d) {
    lines.push(
      '  row ' + d.row_number +
      ' status=' + d.status +
      ' hash=' + d.hash_format +
      ' would_sync=' + (d.would_sync ? 'yes' : 'no') +
      (d.reason ? ' reason=' + d.reason : '')
    );
  });

  lines.push('');
  lines.push('validation: ' + stats.validation);
  if (stats.validation_errors.length) {
    stats.validation_errors.forEach(function (e) { lines.push('  - ' + e); });
  }
  return lines.join('\n');
}
