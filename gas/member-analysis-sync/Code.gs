/**
 * メンバー分析 — Google Form 回答シート → Vercel 差分同期
 * 研究会スケジュール GAS とは完全に独立。
 *
 * lib/member-analysis-questionnaire-v1.js の header 分類と同期すること。
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
  var responses = chunk.map(function (item) {
    var responseMap = buildResponseMap_(item.rowValues, headerMap);
    var ts = pickMetaValue_(responseMap, META_HEADERS.timestamp);
    var email = pickMetaValue_(responseMap, META_HEADERS.email);
    var name = pickMetaValue_(responseMap, META_HEADERS.name);

    return {
      source_response_id: item.decision.syncId,
      answered_at: ts.value,
      respondent_name: name.value || null,
      respondent_email: email.value || null,
      raw_answers: responseMap,
    };
  });

  return {
    source: SYNC_SOURCE,
    questionnaire_version: QUESTIONNAIRE_VERSION,
    responses: responses,
  };
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
