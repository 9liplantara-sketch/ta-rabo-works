#!/usr/bin/env node
/**
 * data/seminar-schedule.sheet.csv から data/seminar-schedule.ics を生成する。
 * スケジュール更新後: node scripts/generate-seminar-ics.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const csvPath = path.join(root, 'data', 'seminar-schedule.sheet.csv');
const jsPath = path.join(root, 'data', 'seminar-schedule.js');
const icsPath = path.join(root, 'data', 'seminar-schedule.ics');

const TYPE_KEYS = {
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
};

function parseCsvLine(line) {
  const cells = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      cells.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  return cells;
}

function loadScheduleFromCsv() {
  const text = fs.readFileSync(csvPath, 'utf8').trim();
  const lines = text.split('\n').filter(Boolean);
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]);
  const idx = Object.fromEntries(headers.map((h, i) => [h, i]));
  return lines.slice(1).map((line) => {
    const row = parseCsvLine(line);
    const typeRaw = row[idx['種別']] || 'lecture';
    const start = row[idx['開始']] || '13:00';
    const end = row[idx['終了']] || '15:00';
    return {
      date: row[idx['日付']],
      type: TYPE_KEYS[typeRaw] || typeRaw,
      content: row[idx['内容']] || '',
      timeOverride: `${start}〜${end}`,
    };
  }).filter((item) => item.date);
}

const code = fs.readFileSync(jsPath, 'utf8');
const { generateSeminarIcs, replaceSeminarSchedule } = new Function(
  `${code}; return { generateSeminarIcs, replaceSeminarSchedule };`
)();
const schedule = loadScheduleFromCsv();
replaceSeminarSchedule(schedule);
const ics = generateSeminarIcs();
fs.writeFileSync(icsPath, ics, 'utf8');
console.log(`Wrote ${icsPath} (${schedule.length} events from CSV)`);
