#!/usr/bin/env node
/**
 * data/seminar-schedule.js から data/seminar-schedule.ics を生成する。
 * スケジュール更新後: node scripts/generate-seminar-ics.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const jsPath = path.join(root, 'data', 'seminar-schedule.js');
const icsPath = path.join(root, 'data', 'seminar-schedule.ics');

const code = fs.readFileSync(jsPath, 'utf8');
const { generateSeminarIcs, SEMINAR_SCHEDULE } = new Function(`${code}; return { generateSeminarIcs, SEMINAR_SCHEDULE };`)();
const ics = generateSeminarIcs();
fs.writeFileSync(icsPath, ics, 'utf8');
console.log(`Wrote ${icsPath} (${SEMINAR_SCHEDULE?.length ?? '?'} events)`);
