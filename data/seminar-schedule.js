/* 研究室研究会 — 年間スケジュールデータ（lab_manager.html から読み込み） */

const SEMINAR_META = {
  title: '研究室研究会スケジュール',
  weekday: '水曜日',
  period: '3限',
  time: '13:00〜15:00',
  intro:
    '研究会は、毎週水曜日3限（13:00〜15:00）に実施します。\n' +
    '基本的には「レクチャー2回 → 発表1回」のサイクルで進め、学生は月に1つのペースで作品・試作・研究アウトプットを制作・発表します。\n' +
    '中間発表・最終発表前は、通常サイクルよりも発表準備や展示準備を優先します。',
  usageGuide: [
    'まず「次回の研究会」で、いちばん近い予定と内容を確認してください。',
    '年間スケジュールは月ごとに区切っています。当月・翌月を中心に、発表回と準備期間をチェックしてください。',
    '色付きラベルは回の種類（レクチャー／発表／制作相談など）を示します。ページ末尾の凡例も参照してください。',
    '中間発表・卒論展示などの公式日程は、上部の強調カードにも掲載しています。',
    '日程変更がある場合は教員から連絡します。このページは学生向けの公式予定表として参照してください。',
  ],
  calendarSyncNote:
    'Googleカレンダーに追加したい場合は、ICSファイルをダウンロードしてインポートするか、公開URLをカレンダーに追加してください。予定が変更される可能性があるため、可能であればURLで購読する方法をおすすめします。',
  calendarSyncHelp: [
    '【URLで購読（推奨）】Googleカレンダー → 左の「他のカレンダー」→「＋」→「URLから追加」→ 下のHTTPSまたはwebcal URLを貼り付け',
    '【ファイルでインポート】「ICSをダウンロード」→ Googleカレンダー → 設定 →「インポートとエクスポート」→「パソコンからファイルを選択」',
    '【Appleカレンダー】「ICSをダウンロード」で開くか、URLを「新規カレンダーサブスクリプション」に追加',
  ],
  icsDefaults: {
    timezone: 'Asia/Tokyo',
    defaultStart: { hour: 13, minute: 0 },
    defaultEnd: { hour: 15, minute: 0 },
    officialFallbackHours: 2,
    midtermStart: { hour: 10, minute: 0 },
  },
  milestones: [
    { date: '2026-08-03', label: '学部卒論中間発表', time: '10:00〜', note: '中間発表前の1週間程度はスライド・発表内容のチェック期間' },
    { date: '2027-02-12', label: '卒論展示期間', time: 'ごろ', note: '1月下旬〜2月上旬は最終発表・展示準備を優先' },
  ],
};

const SEMINAR_TYPE_CONFIG = {
  lecture:           { label: 'レクチャー',       color: '#4488ff' },
  presentation:      { label: '発表',             color: '#0af0a0' },
  consultation:      { label: '制作相談',         color: '#c8a96e' },
  midterm_prep:      { label: '中間発表準備',     color: '#ffa94d' },
  final_prep:        { label: '最終準備',         color: '#ff6b6b' },
  official:          { label: '公式日程',         color: '#ffe066' },
  break:             { label: '休止',             color: '#5a5a68' },
  reflection:        { label: '振り返り',         color: '#748ffc' },
  lecture_consult:   { label: 'レクチャー・相談', color: '#4dabf7' },
  adjustment:        { label: '調整回',           color: '#868e96' },
  reopen:            { label: '再開・計画確認',   color: '#69db7c' },
  pre_presentation:  { label: 'プレ発表',         color: '#ff8787' },
  exhibition_prep:   { label: '展示準備',         color: '#ffd43b' },
};

const SEMINAR_TIMETABLES = {
  lecture: [
    { time: '13:00〜13:10', content: 'チェックイン／前回からの進捗共有' },
    { time: '13:10〜13:45', content: 'レクチャー' },
    { time: '13:45〜14:10', content: '個人ワーク／ミニ演習' },
    { time: '14:10〜14:40', content: '共有・ディスカッション' },
    { time: '14:40〜14:55', content: '次回までの制作課題・リサーチ課題の設定' },
    { time: '14:55〜15:00', content: 'まとめ・連絡事項' },
  ],
  presentation: [
    { time: '13:00〜13:10', content: '進行確認／発表順の確認' },
    { time: '13:10〜14:30', content: '学生発表・講評' },
    { time: '14:30〜14:50', content: '全体講評／共通課題の整理' },
    { time: '14:50〜15:00', content: '次の制作テーマ・改善方針の確認' },
  ],
};

const SEMINAR_SCHEDULE = [
  { date: '2026-07-01', type: 'lecture',          content: '研究テーマの立て方／問い・関心・作品化の方向性' },
  { date: '2026-07-08', type: 'lecture',          content: '中間発表に向けた構成整理／研究と作品の関係づけ' },
  { date: '2026-07-15', type: 'presentation',     content: '中間発表前の第1回発表：テーマ・試作・構想の共有' },
  { date: '2026-07-22', type: 'midterm_prep',     content: 'スライド構成チェック／発表内容の整理' },
  { date: '2026-07-29', type: 'midterm_prep',     content: '発表リハーサル／質疑応答対策／最終修正' },
  { date: '2026-08-03', type: 'official',         content: '学部卒論中間発表 10:00〜', timeOverride: '10:00〜' },
  { date: '2026-08-05', type: 'reflection',       content: '中間発表の振り返り／後期制作計画の再設計' },
  { date: '2026-08-12', type: 'lecture',          content: 'プロトタイピングの進め方／1ヶ月制作の組み立て' },
  { date: '2026-08-19', type: 'lecture_consult',  content: '制作プロセスの記録／途中段階の見せ方' },
  { date: '2026-08-26', type: 'presentation',     content: '8月制作発表：試作1・テーマ再設定' },
  { date: '2026-09-02', type: 'lecture',          content: 'リサーチと観察／素材・場所・身体・関係性の読み取り' },
  { date: '2026-09-09', type: 'lecture',          content: 'コンセプトメイキング／作品の核となる言葉をつくる' },
  { date: '2026-09-16', type: 'consultation',     content: '個別相談／制作途中レビュー' },
  { date: '2026-09-23', type: 'adjustment',       content: '制作・個別相談・自主作業' },
  { date: '2026-09-30', type: 'presentation',     content: '9月制作発表：作品2・コンセプトレビュー' },
  { date: '2026-10-07', type: 'lecture',          content: '実験設計／比較・検証・記録の方法' },
  { date: '2026-10-14', type: 'lecture',          content: '作品の見せ方／体験設計・展示の入口' },
  { date: '2026-10-21', type: 'consultation',     content: '個別相談／制作途中レビュー' },
  { date: '2026-10-28', type: 'presentation',     content: '10月制作発表：作品3・実験結果の共有' },
  { date: '2026-11-04', type: 'lecture',          content: '展示計画の基礎／空間・導線・キャプション' },
  { date: '2026-11-11', type: 'lecture',          content: '研究としての文章化／制作と言葉の接続' },
  { date: '2026-11-18', type: 'consultation',     content: '個別相談／展示・論文の方向性確認' },
  { date: '2026-11-25', type: 'presentation',     content: '11月制作発表：作品4・展示案レビュー' },
  { date: '2026-12-02', type: 'lecture',          content: '卒論構成の組み立て／章立て・論点整理' },
  { date: '2026-12-09', type: 'lecture',          content: '最終作品に向けたブラッシュアップ方針' },
  { date: '2026-12-16', type: 'consultation',     content: '個別相談／論文・作品の進捗確認' },
  { date: '2026-12-23', type: 'presentation',     content: '年内最終発表：最終作品案・論文構成の共有' },
  { date: '2026-12-30', type: 'break',            content: '年末のため原則休止。必要に応じて個別対応' },
  { date: '2027-01-06', type: 'reopen',           content: '年始進捗確認／最終発表までの作業計画' },
  { date: '2027-01-13', type: 'lecture_consult',  content: '発表スライド／展示キャプション／論文要旨の確認' },
  { date: '2027-01-20', type: 'pre_presentation', content: '最終作品・卒論内容のプレ発表' },
  { date: '2027-01-27', type: 'final_prep',       content: '最終発表リハーサル／質疑応答対策' },
  { date: '2027-02-03', type: 'final_prep',       content: '最終発表直前チェック／展示計画の最終確認' },
  { date: '2027-02-10', type: 'exhibition_prep',  content: '展示設営前チェック／作品・キャプション・導線確認' },
  { date: '2027-02-12', type: 'official',         content: '卒論展示期間', timeOverride: '終日' },
];

const WEEKDAY_JA = ['日', '月', '火', '水', '木', '金', '土'];

function formatSeminarDate(isoDate) {
  const d = new Date(isoDate + 'T00:00:00');
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}（${WEEKDAY_JA[d.getDay()]}）`;
}

function getSeminarTypeConfig(type) {
  return SEMINAR_TYPE_CONFIG[type] || { label: type, color: '#8a8898' };
}

function getSeminarsByMonth() {
  const groups = new Map();
  SEMINAR_SCHEDULE.forEach((item) => {
    const key = item.date.slice(0, 7);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  });
  return groups;
}

function getNextSeminar(fromDate) {
  const today = (fromDate || new Date()).toISOString().split('T')[0];
  return SEMINAR_SCHEDULE.find((item) => item.date >= today) || null;
}

function getMonthLabel(yearMonth) {
  const [y, m] = yearMonth.split('-').map(Number);
  return `${y}年${m}月`;
}

/* ── iCalendar エクスポート ───────────────────── */

function icalEscape(text) {
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

function icalFold(line) {
  const bytes = [...line];
  if (bytes.length <= 75) return line;
  let out = bytes.slice(0, 75).join('') + '\r\n';
  let i = 75;
  while (i < bytes.length) {
    out += ' ' + bytes.slice(i, i + 74).join('') + (i + 74 < bytes.length ? '\r\n' : '');
    i += 74;
  }
  return out;
}

function icalDateTimeLocal(dateStr, hour, minute) {
  const [y, m, d] = dateStr.split('-');
  return `${y}${m}${d}T${String(hour).padStart(2, '0')}${String(minute).padStart(2, '0')}00`;
}

function getSeminarEventTimes(item) {
  const cfg = SEMINAR_META.icsDefaults;
  const tz = cfg.timezone;

  if (item.date === '2026-08-03' && item.type === 'official') {
    const startH = cfg.midtermStart.hour;
    const startM = cfg.midtermStart.minute;
    const endH = startH + cfg.officialFallbackHours;
    return {
      tz,
      start: icalDateTimeLocal(item.date, startH, startM),
      end: icalDateTimeLocal(item.date, endH, startM),
    };
  }

  if (item.type === 'official') {
    const startH = 10;
    const startM = 0;
    const endH = startH + cfg.officialFallbackHours;
    return {
      tz,
      start: icalDateTimeLocal(item.date, startH, startM),
      end: icalDateTimeLocal(item.date, endH, startM),
    };
  }

  return {
    tz,
    start: icalDateTimeLocal(item.date, cfg.defaultStart.hour, cfg.defaultStart.minute),
    end: icalDateTimeLocal(item.date, cfg.defaultEnd.hour, cfg.defaultEnd.minute),
  };
}

function getSeminarEventUid(item) {
  return `seminar-${item.date}-${item.type}@ta-rabo-works`;
}

function getSeminarEventSummary(item) {
  const label = getSeminarTypeConfig(item.type).label;
  return `研究会：${label}`;
}

function getSeminarIcsTimezoneBlock() {
  return [
    'BEGIN:VTIMEZONE',
    'TZID:Asia/Tokyo',
    'BEGIN:STANDARD',
    'DTSTART:19700101T000000',
    'TZOFFSETFROM:+0900',
    'TZOFFSETTO:+0900',
    'TZNAME:JST',
    'END:STANDARD',
    'END:VTIMEZONE',
  ].join('\r\n');
}

function generateSeminarIcs() {
  const now = new Date();
  const dtstamp = [
    now.getUTCFullYear(),
    String(now.getUTCMonth() + 1).padStart(2, '0'),
    String(now.getUTCDate()).padStart(2, '0'),
    'T',
    String(now.getUTCHours()).padStart(2, '0'),
    String(now.getUTCMinutes()).padStart(2, '0'),
    String(now.getUTCSeconds()).padStart(2, '0'),
    'Z',
  ].join('');

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ta_rabo Lab//研究会スケジュール//JA',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:ta_rabo 研究会',
    'X-WR-TIMEZONE:Asia/Tokyo',
    getSeminarIcsTimezoneBlock(),
  ];

  SEMINAR_SCHEDULE.forEach((item) => {
    const times = getSeminarEventTimes(item);
    const summary = getSeminarEventSummary(item);
    const description = item.content + (item.timeOverride ? ` (${item.timeOverride})` : '');
    lines.push(
      'BEGIN:VEVENT',
      `UID:${getSeminarEventUid(item)}`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART;TZID=${times.tz}:${times.start}`,
      `DTEND;TZID=${times.tz}:${times.end}`,
      icalFold(`SUMMARY:${icalEscape(summary)}`),
      icalFold(`DESCRIPTION:${icalEscape(description)}`),
      'LOCATION:ta_rabo 研究室',
      'STATUS:CONFIRMED',
      'END:VEVENT'
    );
  });

  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

function getSeminarIcsPublicUrl(baseHref) {
  const fallback = 'https://9liplantara-sketch.github.io/ta-rabo-works/data/seminar-schedule.ics';
  try {
    const href = baseHref || (typeof location !== 'undefined' ? location.href : '');
    if (!href || href.startsWith('file:')) return fallback;
    return new URL('./data/seminar-schedule.ics', href).href.split('?')[0];
  } catch {
    return fallback;
  }
}

function getSeminarWebcalUrl(baseHref) {
  return getSeminarIcsPublicUrl(baseHref).replace(/^https?:/i, 'webcal:');
}
