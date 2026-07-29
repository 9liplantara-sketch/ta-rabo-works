#!/usr/bin/env node
/**
 * data/seminar-schedule.js から
 *  - data/seminar-schedule.sheet.csv（スプレッドシート取り込み用）
 *  - gas/seminar-reminder/SeedSchedule.gs（GAS 一括投入用）
 * を生成する。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const jsPath = path.join(root, 'data', 'seminar-schedule.js');
const csvPath = path.join(root, 'data', 'seminar-schedule.sheet.csv');
const gasPath = path.join(root, 'gas', 'seminar-reminder', 'SeedSchedule.gs');

const TYPE_LABELS = {
  lecture: 'レクチャー',
  presentation: '発表',
  consultation: '制作相談',
  midterm_prep: '中間発表準備',
  final_prep: '最終準備',
  official: '公式日程',
  break: '休止',
  reflection: '振り返り',
  lecture_consult: 'レクチャー・相談',
  adjustment: '調整回',
  reopen: '再開・計画確認',
  pre_presentation: 'プレ発表',
  exhibition_prep: '展示準備',
};

const DEFAULT_PLACE = 'プロトタイピングラボ';

function parseScheduleFromJs(source) {
  const m = source.match(/const SEMINAR_SCHEDULE = (\[[\s\S]*?\n\]);/);
  if (!m) throw new Error('SEMINAR_SCHEDULE が見つかりません');
  // eslint-disable-next-line no-eval
  return eval(m[1]);
}

function parseTimeOverride(item) {
  if (!item.timeOverride) return { start: '13:00', end: '15:00' };
  const m = String(item.timeOverride).match(/(\d{1,2}:\d{2})\s*[〜~\-–—]\s*(\d{1,2}:\d{2})/);
  if (m) return { start: m[1], end: m[2] };
  return { start: '13:00', end: '15:00' };
}

function csvEscape(value) {
  const s = String(value ?? '');
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toSheetRow(item) {
  const { start, end } = parseTimeOverride(item);
  const remind = item.type === 'break' ? 'FALSE' : 'TRUE';
  return [
    item.date,
    start,
    end,
    DEFAULT_PLACE,
    TYPE_LABELS[item.type] || item.type,
    item.content || '',
    '',
    '',
    remind,
    '',
  ];
}

const source = fs.readFileSync(jsPath, 'utf8');
const schedule = parseScheduleFromJs(source);
const headers = ['日付', '開始', '終了', '場所', '種別', '内容', '提出物', '準備物', 'リマインド', '備考'];
const rows = schedule.map(toSheetRow);

const csvLines = [
  headers.map(csvEscape).join(','),
  ...rows.map((row) => row.map(csvEscape).join(',')),
];
fs.writeFileSync(csvPath, `${csvLines.join('\n')}\n`, 'utf8');

const gasRows = rows
  .map((row) => {
    const cells = row.map((c) => JSON.stringify(c));
    return `    [${cells.join(', ')}]`;
  })
  .join(',\n');

const gasSource = `/**
 * 自動生成: node scripts/generate-seminar-sheet-csv.mjs
 * data/seminar-schedule.js と同期。手編集しない。
 */
var BUILTIN_SCHEDULE_ROWS = [
${gasRows}
];
`;

fs.writeFileSync(gasPath, gasSource, 'utf8');
console.log(`Wrote ${rows.length} rows → ${path.relative(root, csvPath)}`);
console.log(`Wrote ${path.relative(root, gasPath)}`);
