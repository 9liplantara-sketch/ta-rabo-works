/**
 * 研究会日程：スプレッドシート → LINE リマインド ＋ サイト用 JSON
 *
 * 想定シート:
 *   研究会日程 … 日程マスタ
 *   LINE設定   … groupId など（Webhook で自動更新）
 *
 * 研究会日程 1行目ヘッダー:
 *   日付 | 開始 | 終了 | 場所 | 種別 | 内容 | 提出物 | 準備物 | リマインド | 備考
 *
 * スクリプトプロパティ（手動で入れるのはこれだけ）:
 *   LINE_CHANNEL_ACCESS_TOKEN  Messaging API の長期チャネルアクセストークン
 *
 * LINE_GROUP_ID は Webhook で自動保存される。
 *   ※ LINE の Webhook URL は GAS 直ではなく
 *     https://ta-rabo-works.vercel.app/api/line-webhook
 *     を使う（GAS 直指定はタイムアウトしやすい）。
 *
 * デプロイ: ウェブアプリ（自分として実行 / 全員アクセス可）
 *   - doGet  … サイト用 JSON ＋ saveGroupId 受け取り
 *   - doPost … 予備（本番 Webhook は Vercel 経由）
 * トリガー: sendDailyReminders を毎日 10:00（Asia/Tokyo）
 */

var SHEET_NAME = '研究会日程';
var SETTINGS_SHEET = 'LINE設定';
var WEEKDAY_JA = ['日', '月', '火', '水', '木', '金', '土'];

var TYPE_ALIASES = {
  'レクチャー': 'lecture',
  '発表': 'presentation',
  '制作相談': 'consultation',
  '中間発表準備': 'midterm_prep',
  '最終準備': 'final_prep',
  '公式日程': 'official',
  '休止': 'break',
  '振り返り': 'reflection',
  'レクチャー・相談': 'lecture_consult',
  '調整回': 'adjustment',
  '再開・計画確認': 'reopen',
  'プレ発表': 'pre_presentation',
  '展示準備': 'exhibition_prep',
  lecture: 'lecture',
  presentation: 'presentation',
  consultation: 'consultation',
  midterm_prep: 'midterm_prep',
  final_prep: 'final_prep',
  official: 'official',
  break: 'break',
  reflection: 'reflection',
  lecture_consult: 'lecture_consult',
  adjustment: 'adjustment',
  reopen: 'reopen',
  pre_presentation: 'pre_presentation',
  exhibition_prep: 'exhibition_prep'
};

/* ════════════════════════════════════════
   Web エンドポイント
════════════════════════════════════════ */

/** サイト用 JSON ／ groupId 保存（Vercel プロキシから） */
function doGet(e) {
  // Vercel Webhook プロキシからの groupId 保存
  var saveId = e && e.parameter && e.parameter.saveGroupId
    ? String(e.parameter.saveGroupId).trim()
    : '';
  if (saveId) {
    var eventType = (e.parameter.eventType && String(e.parameter.eventType)) || 'vercel-proxy';
    var isNew = saveGroupId_(saveId, eventType);
    if (isNew && props_('LINE_CHANNEL_ACCESS_TOKEN')) {
      try {
        pushLine_(
          '研究会リマインドBotの設定が完了しました。\n' +
          'このグループへ、研究会の2日前・前日 10:00 に通知します。\n' +
          '（groupId: ' + saveId + '）'
        );
      } catch (err) {
        console.error('confirm push failed', err);
        setSetting_('LAST_ERROR', 'confirm push: ' + String(err));
      }
    }
    return ContentService
      .createTextOutput(JSON.stringify({
        ok: true,
        saved: true,
        isNew: isNew,
        groupId: saveId
      }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  var payload = {
    ok: true,
    source: 'google-sheets',
    updatedAt: new Date().toISOString(),
    groupIdReady: !!resolveGroupId_(),
    schedule: readScheduleRows().map(toPublicItem)
  };
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * LINE Webhook 直受け用（非推奨：タイムアウトしやすい）。
 * 本番の Webhook URL は Vercel /api/line-webhook を使う。
 */
function doPost(e) {
  try {
    var body = e && e.postData && e.postData.contents ? e.postData.contents : '';
    if (body) handleWebhook_(body);
  } catch (err) {
    console.error('doPost error', err);
    setSetting_('LAST_ERROR', String(err));
  }
  return ContentService.createTextOutput('OK');
}

/* ════════════════════════════════════════
   Webhook → groupId 保存
════════════════════════════════════════ */

function handleWebhook_(raw) {
  setSetting_('LAST_WEBHOOK_AT', new Date().toISOString());
  setSetting_('LAST_WEBHOOK_RAW', String(raw).slice(0, 1500));

  var data = JSON.parse(raw);
  var events = data.events || [];
  var saved = null;

  events.forEach(function (ev) {
    var source = ev.source || {};
    var groupId = source.groupId || '';
    if (!groupId) return;

    var isNew = saveGroupId_(groupId, ev.type || 'event');
    if (isNew) saved = { groupId: groupId, type: ev.type || 'event' };
  });

  // 初めて groupId を取れたときだけ、確認メッセージをグループへ送る
  if (saved && props_('LINE_CHANNEL_ACCESS_TOKEN')) {
    try {
      pushLine_(
        '研究会リマインドBotの設定が完了しました。\n' +
        'このグループへ、研究会の2日前・前日 10:00 に通知します。\n' +
        '（groupId: ' + saved.groupId + '）'
      );
    } catch (err) {
      console.error('confirm push failed', err);
      setSetting_('LAST_ERROR', 'confirm push: ' + String(err));
    }
  }
}

/** @return {boolean} 新規保存したとき true */
function saveGroupId_(groupId, eventType) {
  var prev = resolveGroupId_();
  PropertiesService.getScriptProperties().setProperty('LINE_GROUP_ID', groupId);
  setSetting_('LINE_GROUP_ID', groupId);
  setSetting_('GROUP_ID_EVENT', eventType || '');
  setSetting_('STATUS', prev === groupId ? 'groupId更新（同一）' : 'groupId取得済み');
  return prev !== groupId;
}

function resolveGroupId_() {
  var fromProps = props_('LINE_GROUP_ID');
  if (fromProps) return fromProps;
  return getSetting_('LINE_GROUP_ID');
}

/* ════════════════════════════════════════
   リマインド
════════════════════════════════════════ */

/** 手動テスト用 */
function testReminders() {
  sendDailyReminders();
}

/** 手動テスト用：直近の予定を1件送る */
function testPushSample() {
  var rows = readScheduleRows().filter(function (r) { return r.remind; });
  if (!rows.length) throw new Error('リマインド対象の予定がありません');
  var today = todayYmd_();
  var target = rows.find(function (r) { return r.date >= today; }) || rows[0];
  pushLine_(buildMessage_(target, 1));
}

/** groupId が保存されているか確認 */
function checkLineSetup() {
  var token = props_('LINE_CHANNEL_ACCESS_TOKEN');
  var groupId = resolveGroupId_();
  var msg = [
    'TOKEN: ' + (token ? 'OK（長さ ' + token.length + '）' : '未設定'),
    'GROUP_ID: ' + (groupId || '未取得（Botをグループに招待し、何か発言してください）'),
    'STATUS: ' + (getSetting_('STATUS') || '—')
  ].join('\n');
  Logger.log(msg);
  setSetting_('LAST_CHECK', msg);
  return msg;
}

function sendDailyReminders() {
  var token = props_('LINE_CHANNEL_ACCESS_TOKEN');
  var groupId = resolveGroupId_();
  if (!token) {
    console.error('LINE_CHANNEL_ACCESS_TOKEN が未設定です');
    setSetting_('LAST_ERROR', 'LINE_CHANNEL_ACCESS_TOKEN 未設定');
    return;
  }
  if (!groupId) {
    console.error('LINE_GROUP_ID 未取得です。Webhook でグループ招待→発言してください');
    setSetting_('LAST_ERROR', 'LINE_GROUP_ID 未取得');
    return;
  }

  var today = todayYmd_();
  var inOne = addDaysYmd_(today, 1);
  var inTwo = addDaysYmd_(today, 2);
  var rows = readScheduleRows().filter(function (r) { return r.remind; });
  var sent = 0;

  rows.forEach(function (row) {
    if (row.date === inTwo) {
      pushLine_(buildMessage_(row, 2));
      sent++;
    }
    if (row.date === inOne) {
      pushLine_(buildMessage_(row, 1));
      sent++;
    }
  });

  setSetting_('LAST_REMINDER_AT', new Date().toISOString());
  setSetting_('LAST_REMINDER_SENT', String(sent));
}

function readScheduleRows() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error('シート「' + SHEET_NAME + '」が見つかりません');

  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];

  var headers = values[0].map(function (h) { return String(h).trim(); });
  var idx = indexMap_(headers);
  requireHeaders_(idx, ['日付']);

  var rows = [];
  for (var i = 1; i < values.length; i++) {
    var raw = values[i];
    var date = normalizeDate_(raw[idx['日付']]);
    if (!date) continue;

    var start = normalizeTime_(raw[idx['開始']], '13:00');
    var end = normalizeTime_(raw[idx['終了']], '15:00');
    var place = cell_(raw, idx['場所']);
    var type = normalizeType_(cell_(raw, idx['種別']));
    var content = cell_(raw, idx['内容']);
    var submissions = cell_(raw, idx['提出物']);
    var preparations = cell_(raw, idx['準備物']);
    var remind = normalizeRemind_(raw[idx['リマインド']]);
    var note = cell_(raw, idx['備考']);

    rows.push({
      date: date,
      start: start,
      end: end,
      place: place,
      type: type,
      content: content,
      submissions: submissions,
      preparations: preparations,
      remind: remind,
      note: note,
      timeOverride: start + '〜' + end
    });
  }

  rows.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
  return rows;
}

function toPublicItem(row) {
  return {
    date: row.date,
    type: row.type,
    content: row.content,
    place: row.place,
    submissions: row.submissions,
    preparations: row.preparations,
    note: row.note,
    start: row.start,
    end: row.end,
    timeOverride: row.timeOverride
  };
}

function buildMessage_(row, daysBefore) {
  var whenLabel = daysBefore === 1 ? '明日' : formatDateJa_(row.date);
  var place = row.place || '（場所未設定）';
  var lines = [];

  if (daysBefore === 1) {
    lines.push('【研究会リマインド｜前日】');
    lines.push('明日は' + place + 'で研究会があります。');
  } else {
    lines.push('【研究会リマインド｜2日前】');
    lines.push(whenLabel + 'は' + place + 'で研究会があります。');
  }

  lines.push('');
  lines.push('日時：' + formatDateJa_(row.date) + ' ' + row.start + '〜' + row.end);
  if (row.content) lines.push('内容：' + row.content);

  var extras = [];
  if (row.submissions) extras.push('提出物：' + row.submissions);
  if (row.preparations) extras.push('準備物：' + row.preparations);
  if (extras.length) {
    lines.push('');
    lines = lines.concat(extras);
  } else {
    lines.push('');
    lines.push('提出物・準備物：特になし（連絡がある場合は教員から共有します）');
  }

  if (row.note) {
    lines.push('');
    lines.push('備考：' + row.note);
  }

  return lines.join('\n');
}

function pushLine_(text) {
  var token = props_('LINE_CHANNEL_ACCESS_TOKEN');
  var groupId = resolveGroupId_();
  if (!token) throw new Error('LINE_CHANNEL_ACCESS_TOKEN が未設定です');
  if (!groupId) throw new Error('LINE_GROUP_ID が未取得です');

  var res = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify({
      to: groupId,
      messages: [{ type: 'text', text: text }]
    }),
    muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  if (code < 200 || code >= 300) {
    console.error('LINE push failed', code, res.getContentText());
    throw new Error('LINE push failed: ' + code + ' ' + res.getContentText());
  }
}

/* ════════════════════════════════════════
   LINE設定シート
════════════════════════════════════════ */

function ensureSettingsSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SETTINGS_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(SETTINGS_SHEET);
    sheet.getRange(1, 1, 1, 3).setValues([['キー', '値', '更新日時']]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function setSetting_(key, value) {
  var sheet = ensureSettingsSheet_();
  var data = sheet.getDataRange().getValues();
  var now = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss');
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === key) {
      sheet.getRange(i + 1, 2, i + 1, 3).setValues([[value, now]]);
      return;
    }
  }
  sheet.appendRow([key, value, now]);
}

function getSetting_(key) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SETTINGS_SHEET);
  if (!sheet) return '';
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === key) return String(data[i][1] || '').trim();
  }
  return '';
}

/* ════════════════════════════════════════
   helpers
════════════════════════════════════════ */

function props_(key) {
  return PropertiesService.getScriptProperties().getProperty(key) || '';
}

function indexMap_(headers) {
  var map = {};
  headers.forEach(function (h, i) { if (h) map[h] = i; });
  return map;
}

function requireHeaders_(idx, names) {
  names.forEach(function (name) {
    if (idx[name] === undefined) throw new Error('ヘッダー「' + name + '」がありません');
  });
}

function cell_(row, index) {
  if (index === undefined || index === null) return '';
  var v = row[index];
  if (v === null || v === undefined) return '';
  if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime())) {
    return Utilities.formatDate(v, 'Asia/Tokyo', 'HH:mm');
  }
  return String(v).trim();
}

function normalizeDate_(value) {
  if (value === null || value === undefined || value === '') return '';
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, 'Asia/Tokyo', 'yyyy-MM-dd');
  }
  var s = String(value).trim().replace(/\//g, '-');
  var m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!m) return '';
  return m[1] + '-' + pad2_(m[2]) + '-' + pad2_(m[3]);
}

function normalizeTime_(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, 'Asia/Tokyo', 'HH:mm');
  }
  var s = String(value).trim();
  var m = s.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return fallback;
  return pad2_(m[1]) + ':' + m[2];
}

function normalizeType_(value) {
  if (!value) return 'lecture';
  return TYPE_ALIASES[value] || value;
}

function normalizeRemind_(value) {
  if (value === null || value === undefined || value === '') return true;
  if (typeof value === 'boolean') return value;
  var s = String(value).trim().toLowerCase();
  if (['false', '0', 'no', 'ng', 'オフ', 'しない', '×', 'x'].indexOf(s) >= 0) return false;
  return true;
}

function todayYmd_() {
  return Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
}

function addDaysYmd_(ymd, days) {
  var parts = ymd.split('-').map(Number);
  var d = new Date(parts[0], parts[1] - 1, parts[2]);
  d.setDate(d.getDate() + days);
  return Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy-MM-dd');
}

function formatDateJa_(ymd) {
  var parts = ymd.split('-').map(Number);
  var d = new Date(parts[0], parts[1] - 1, parts[2]);
  return parts[0] + '年' + parts[1] + '月' + parts[2] + '日（' + WEEKDAY_JA[d.getDay()] + '）';
}

function pad2_(n) {
  return ('0' + Number(n)).slice(-2);
}
