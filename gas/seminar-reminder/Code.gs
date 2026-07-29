/**
 * 研究会日程：スプレッドシート → LINE リマインド ＋ サイト用 JSON
 *
 * 想定シート:
 *   研究会日程 … 日程マスタ（「シート1」でも可）
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
  try {
    var saveId = e && e.parameter && e.parameter.saveGroupId
      ? String(e.parameter.saveGroupId).trim()
      : '';
    var saveUserId = e && e.parameter && e.parameter.saveUserId
      ? String(e.parameter.saveUserId).trim()
      : '';
    if (saveUserId) {
      return savePushTargetResponse_(saveUserId, (e.parameter.eventType && String(e.parameter.eventType)) || 'vercel-proxy');
    }
    if (saveId) {
      return savePushTargetResponse_(saveId, (e.parameter.eventType && String(e.parameter.eventType)) || 'vercel-proxy');
    }

    var schedule = [];
    try {
      schedule = readScheduleRows().map(toPublicItem);
    } catch (scheduleErr) {
      schedule = [];
    }

    var payload = {
      ok: true,
      source: 'google-sheets',
      updatedAt: new Date().toISOString(),
      groupIdReady: !!resolvePushTarget_(),
      schedule: schedule
    };
    return ContentService
      .createTextOutput(JSON.stringify(payload))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function savePushTargetResponse_(targetId, eventType) {
  var isNew = savePushTarget_(targetId, eventType);
  if (isNew && props_('LINE_CHANNEL_ACCESS_TOKEN')) {
    try {
      pushLine_(
        '研究会リマインドBotの設定が完了しました。\n' +
        'このトークへ、研究会の2日前・前日 10:00 に通知します。\n' +
        'スプレッドシート「研究会日程」を編集すると内容が反映されます。'
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
      pushTarget: targetId
    }))
    .setMimeType(ContentService.MimeType.JSON);
}

function saveGroupIdResponse_(saveId, eventType) {
  return savePushTargetResponse_(saveId, eventType);
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
   Webhook → 通知先保存（グループ優先 / 1対1は補助）
════════════════════════════════════════ */

function extractPushTargetFromEvent(ev) {
  var source = (ev && ev.source) || {};
  if (source.groupId) {
    return { id: String(source.groupId), mode: 'group', eventType: ev.type || 'event' };
  }
  if (source.roomId) {
    return { id: String(source.roomId), mode: 'room', eventType: ev.type || 'event' };
  }
  if (source.userId && source.type === 'user') {
    return { id: String(source.userId), mode: 'user', eventType: ev.type || 'event' };
  }
  return null;
}

function handleWebhook_(raw) {
  setSetting_('LAST_WEBHOOK_AT', new Date().toISOString());
  setSetting_('LAST_WEBHOOK_RAW', String(raw).slice(0, 1500));

  var data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    setSetting_('LAST_ERROR', 'JSON parse: ' + String(err));
    return;
  }

  var events = data.events || [];
  if (!events.length) {
    setSetting_('LAST_ERROR', '');
    setSetting_('STATUS', 'Webhook接続OK（検証 ping・events 空）');
    setSetting_('LAST_EVENT_TYPE', 'verify');
    return;
  }

  var saved = null;

  events.forEach(function (ev) {
    var hit = extractPushTargetFromEvent(ev);
    setSetting_('LAST_EVENT_TYPE', ev.type || '');
    setSetting_('LAST_SOURCE_TYPE', (ev.source && ev.source.type) || '');

    if (!hit) {
      setSetting_('LAST_ERROR', '通知先IDなし type=' + (ev.type || '?') + ' source=' + ((ev.source && ev.source.type) || '?'));
      return;
    }

    setSetting_('LAST_SEEN_ID', hit.id);
    setSetting_('LAST_SEEN_MODE', hit.mode);

    // グループ / 複数人トーク優先（全員に届く）
    if (hit.mode === 'group' || hit.mode === 'room') {
      var isNew = savePushTarget_(hit.id, hit.eventType, hit.mode);
      if (isNew) saved = hit;
      return;
    }

    // 1対1（group/room が未取得のときだけ）
    if (hit.mode === 'user' && !resolveGroupId_()) {
      var isNewUser = savePushTarget_(hit.id, hit.eventType, hit.mode);
      if (isNewUser) saved = hit;
    }
  });

  if (saved && props_('LINE_CHANNEL_ACCESS_TOKEN')) {
    try {
      var label = saved.mode === 'group' ? 'グループ' : (saved.mode === 'room' ? '複数人トーク' : 'トーク');
      pushLine_(
        '研究会リマインドBotの設定が完了しました。\n' +
        'この' + label + 'へ、研究会の2日前・前日 10:00 に通知します。'
      );
    } catch (err) {
      console.error('confirm push failed', err);
      setSetting_('LAST_ERROR', 'confirm push: ' + String(err));
    }
  }
}

/** LINE設定 の LAST_WEBHOOK_RAW から ID を再解析して保存（診断用） */
function debugLastWebhook() {
  var raw = getSetting_('LAST_WEBHOOK_RAW');
  if (!raw) {
    Logger.log('LAST_WEBHOOK_RAW がありません');
    return;
  }
  handleWebhook_(raw);
  Logger.log(checkLineSetup());
}

/** @return {boolean} 新規保存したとき true */
function savePushTarget_(targetId, eventType, mode) {
  var prev = resolvePushTarget_();
  var isUser = String(targetId).indexOf('U') === 0;
  var isRoom = String(targetId).indexOf('R') === 0;
  if (isUser) {
    PropertiesService.getScriptProperties().setProperty('LINE_USER_ID', targetId);
    setSetting_('LINE_USER_ID', targetId);
    setSetting_('PUSH_TARGET_TYPE', '1対1トーク');
  } else {
    PropertiesService.getScriptProperties().setProperty('LINE_GROUP_ID', targetId);
    setSetting_('LINE_GROUP_ID', targetId);
    setSetting_('PUSH_TARGET_TYPE', isRoom || mode === 'room' ? '複数人トーク' : 'グループ');
  }
  setSetting_('PUSH_TARGET_EVENT', eventType || '');
  setSetting_('STATUS', prev === targetId ? '通知先更新（同一）' : '通知先取得済み');
  setSetting_('LAST_ERROR', '');
  return prev !== targetId;
}

function saveGroupId_(groupId, eventType) {
  return savePushTarget_(groupId, eventType);
}

function resolvePushTarget_() {
  // 研究室運用はグループ優先（全員に届く）
  var groupId = resolveGroupId_();
  if (groupId) return groupId;
  var userId = props_('LINE_USER_ID');
  if (userId) return userId;
  userId = getSetting_('LINE_USER_ID');
  if (userId) return userId;
  return '';
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
  var target = resolvePushTarget_();
  var msg = [
    'TOKEN: ' + (token ? 'OK（長さ ' + token.length + '）' : '未設定'),
    'PUSH_TARGET: ' + (target || '未取得'),
    'PUSH_TARGET_TYPE: ' + (getSetting_('PUSH_TARGET_TYPE') || '—'),
    'STATUS: ' + (getSetting_('STATUS') || '—'),
    'LAST_WEBHOOK_AT: ' + (getSetting_('LAST_WEBHOOK_AT') || '—'),
    'LAST_SEEN_ID: ' + (getSetting_('LAST_SEEN_ID') || '—'),
    'LAST_SEEN_MODE: ' + (getSetting_('LAST_SEEN_MODE') || '—'),
    'LAST_EVENT_TYPE: ' + (getSetting_('LAST_EVENT_TYPE') || '—'),
    'LAST_SOURCE_TYPE: ' + (getSetting_('LAST_SOURCE_TYPE') || '—'),
    'LAST_ERROR: ' + (getSetting_('LAST_ERROR') || '—'),
    '',
    '未取得のとき: 研究室グループに Bot を招待し、グループ内で「開始」と送信'
  ].join('\n');
  Logger.log(msg);
  try {
    setSetting_('LAST_CHECK', 'PUSH_TARGET=' + (target || '未取得') + ' / ' + (getSetting_('LAST_ERROR') || 'OK'));
  } catch (err) {
    Logger.log('LAST_CHECK 保存スキップ: ' + err);
  }
  return msg;
}

/**
 * 1対1トーク用 userId を手動登録（Webhook が届かないとき）
 * 1. 下の USER_ID に U から始まる ID を貼る
 * 2. registerUserIdManual を実行
 */
function registerUserIdManual() {
  var USER_ID = 'ここにUから始まるuserIdを貼る';
  if (!USER_ID || USER_ID.indexOf('U') !== 0) {
    throw new Error('USER_ID を U から始まる userId に書き換えてから実行してください');
  }
  savePushTargetResponse_(USER_ID, 'manual');
  Logger.log('registered: ' + USER_ID);
}

/** GAS Webアプリが正常か確認（ブラウザでも開ける） */
function testGasWebApp() {
  Logger.log(checkLineSetup());
}

function sendDailyReminders() {
  var token = props_('LINE_CHANNEL_ACCESS_TOKEN');
  var target = resolvePushTarget_();
  if (!token) {
    console.error('LINE_CHANNEL_ACCESS_TOKEN が未設定です');
    setSetting_('LAST_ERROR', 'LINE_CHANNEL_ACCESS_TOKEN 未設定');
    return;
  }
  if (!target) {
    console.error('通知先未取得。研究室グループに Bot を招待し「開始」と送信してください');
    setSetting_('LAST_ERROR', '通知先未取得');
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

/* ════════════════════════════════════════
   研究会日程シート（マスタ）
════════════════════════════════════════ */

var SCHEDULE_HEADERS = ['日付', '開始', '終了', '場所', '種別', '内容', '提出物', '準備物', 'リマインド', '備考'];

/** 「研究会日程」または「シート1」を返す（後者は初回セットアップ用） */
function getScheduleSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(SHEET_NAME) || ss.getSheetByName('シート1');
}

function ensureScheduleSheetForSeed_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('シート1') || ss.getSheetByName(SHEET_NAME);
  if (sheet) return sheet;
  return ss.insertSheet(SHEET_NAME);
}

/**
 * 初回投入: 現在の年間研究会日程をシートに書き込む。
 * Apps Script に SeedSchedule.gs も追加してから実行する。
 */
function seedSeminarSchedule() {
  if (typeof BUILTIN_SCHEDULE_ROWS === 'undefined') {
    throw new Error('SeedSchedule.gs を Apps Script プロジェクトに追加してください');
  }
  var sheet = ensureScheduleSheetForSeed_();
  var rows = BUILTIN_SCHEDULE_ROWS;
  sheet.clear();
  sheet.getRange(1, 1, 1, SCHEDULE_HEADERS.length).setValues([SCHEDULE_HEADERS]);
  if (rows.length) {
    sheet.getRange(2, 1, rows.length + 1, SCHEDULE_HEADERS.length).setValues(rows);
  }
  sheet.setFrozenRows(1);
  setSetting_('STATUS', '日程マスタ投入済み（' + rows.length + '件）');
  Logger.log('seedSeminarSchedule: ' + rows.length + ' 件 → 「' + sheet.getName() + '」');
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('研究会リマインド')
    .addItem('初回日程を投入', 'seedSeminarSchedule')
    .addItem('LINE設定を確認', 'checkLineSetup')
    .addItem('テスト通知を1件送る', 'testPushSample')
    .addToUi();
}

function readScheduleRows() {
  var sheet = getScheduleSheet_();
  if (!sheet) throw new Error('シート「' + SHEET_NAME + '」または「シート1」が見つかりません');

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
  var target = resolvePushTarget_();
  if (!token) throw new Error('LINE_CHANNEL_ACCESS_TOKEN が未設定です');
  if (!target) throw new Error('通知先が未取得です');

  var res = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify({
      to: target,
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
  var text = value === null || value === undefined ? '' : String(value);
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === key) {
      var row = i + 1;
      // setValues は結合セルがあると「1行データ vs 2行範囲」で落ちるため、セル単位で書く
      sheet.getRange(row, 2).setValue(text);
      sheet.getRange(row, 3).setValue(now);
      return;
    }
  }
  sheet.appendRow([key, text, now]);
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
