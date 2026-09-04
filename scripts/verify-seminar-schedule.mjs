#!/usr/bin/env node
/**
 * seminar-schedule CORS / timeout / query contract (pure + source).
 * Production/DB にはアクセスしない。
 */
import { readFileSync } from 'node:fs';
import { applyCors, handleOptions } from '../lib/cors.js';
import { withCors } from '../lib/http.js';
import {
  fetchSeminarScheduleFromGas,
  __testResetSeminarScheduleCache,
  GAS_FETCH_TIMEOUT_MS,
} from '../lib/seminar-schedule-source.js';

let passed = 0;
let failed = 0;

function assert(cond, label) {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}`);
  }
}

function mockRes() {
  const headers = {};
  let statusCode = 200;
  let body = null;
  let ended = false;
  return {
    headers,
    get statusCode() { return statusCode; },
    get body() { return body; },
    get ended() { return ended; },
    setHeader(k, v) { headers[k.toLowerCase()] = v; },
    status(code) { statusCode = code; return this; },
    json(obj) { body = obj; ended = true; return this; },
    end() { ended = true; return this; },
  };
}

function githubPagesReq(method = 'GET', extraHeaders = {}) {
  return {
    method,
    url: '/api/seminar-schedule',
    headers: {
      origin: 'https://9liplantara-sketch.github.io',
      ...extraHeaders,
    },
  };
}

console.log('\n=== CORS helper (GitHub Pages origin) ===\n');
{
  const res = mockRes();
  applyCors(githubPagesReq(), res);
  assert(
    res.headers['access-control-allow-origin'] === 'https://9liplantara-sketch.github.io',
    'GET: Allow-Origin = GitHub Pages',
  );
  assert(
    String(res.headers['access-control-allow-headers']).toLowerCase().includes('authorization'),
    'GET: Allow-Headers includes Authorization',
  );
  assert(
    String(res.headers['access-control-allow-methods']).includes('GET'),
    'GET: Allow-Methods includes GET',
  );

  const optRes = mockRes();
  handleOptions(githubPagesReq('OPTIONS'), optRes);
  assert(optRes.statusCode === 204, 'OPTIONS → 204');
  assert(
    optRes.headers['access-control-allow-origin'] === 'https://9liplantara-sketch.github.io',
    'OPTIONS: Allow-Origin = GitHub Pages',
  );
  assert(
    String(optRes.headers['access-control-allow-headers']).toLowerCase().includes('authorization'),
    'OPTIONS: Allow-Headers includes Authorization',
  );

  const denied = mockRes();
  applyCors({ method: 'GET', headers: { origin: 'https://evil.example' } }, denied);
  assert(
    denied.headers['access-control-allow-origin'] == null,
    'unknown origin: no Allow-Origin',
  );
}

console.log('\n=== withCors: success / error keep CORS ===\n');
{
  const okHandler = withCors(async (req, res) => {
    res.status(200).json({ ok: true, schedule: [{ date: '2026-09-04' }] });
  });
  const okRes = mockRes();
  await okHandler(githubPagesReq(), okRes);
  assert(okRes.statusCode === 200, 'GET success → 200');
  assert(okRes.body?.ok === true, 'GET success body ok');
  assert(
    okRes.headers['access-control-allow-origin'] === 'https://9liplantara-sketch.github.io',
    'GET success: CORS header present',
  );

  const errHandler = withCors(async () => {
    const err = new Error('simulated backend failure');
    err.status = 504;
    throw err;
  });
  const errRes = mockRes();
  await errHandler(githubPagesReq(), errRes);
  assert(errRes.statusCode === 504, 'simulated error → 504');
  assert(errRes.body?.error, 'simulated error has message');
  assert(
    errRes.headers['access-control-allow-origin'] === 'https://9liplantara-sketch.github.io',
    'error response: CORS header present',
  );

  const optHandler = withCors(async (req, res) => {
    res.status(200).json({ shouldNotRun: true });
  });
  const optRes = mockRes();
  await optHandler(githubPagesReq('OPTIONS'), optRes);
  assert(optRes.statusCode === 204, 'withCors OPTIONS → 204 (handler not required)');
  assert(optRes.body == null, 'withCors OPTIONS does not run handler body');
  assert(
    optRes.headers['access-control-allow-origin'] === 'https://9liplantara-sketch.github.io',
    'withCors OPTIONS: CORS header present',
  );
}

console.log('\n=== GAS fetch timeout / cache ===\n');
{
  const prev = process.env.SEMINAR_SCHEDULE_GAS_URL;
  process.env.SEMINAR_SCHEDULE_GAS_URL = 'https://example.invalid/gas';
  __testResetSeminarScheduleCache();

  assert(GAS_FETCH_TIMEOUT_MS === 7000, 'GAS timeout = 7000ms (margin under Hobby 10s)');
  assert(GAS_FETCH_TIMEOUT_MS < 10000, 'GAS timeout < Hobby maxDuration 10s');

  const abortErr = new Error('aborted');
  abortErr.name = 'AbortError';
  try {
    await fetchSeminarScheduleFromGas({
      timeoutMs: 5,
      fetchImpl: async (_url, opts) => {
        assert(!!opts?.signal, 'fetch receives AbortSignal');
        throw abortErr;
      },
    });
    assert(false, 'timeout should throw');
  } catch (e) {
    assert(e.status === 504, 'AbortError → status 504');
    assert(String(e.message).includes('タイムアウト'), '504 message mentions timeout');
  }

  __testResetSeminarScheduleCache();
  const payload = {
    source: 'google-sheets',
    updatedAt: '2026-09-04T00:00:00.000Z',
    schedule: [{ date: '2026-09-10', type: 'lecture', content: 'test' }],
  };
  let fetchCount = 0;
  const fetchImpl = async () => {
    fetchCount += 1;
    return {
      ok: true,
      text: async () => JSON.stringify(payload),
    };
  };
  const first = await fetchSeminarScheduleFromGas({ fetchImpl, now: 1_000 });
  const second = await fetchSeminarScheduleFromGas({ fetchImpl, now: 1_000 + 10_000 });
  assert(first.schedule.length === 1, 'GAS success → schedule mapped');
  assert(fetchCount === 1, 'in-memory cache: second call does not refetch');
  assert(second.schedule[0].date === '2026-09-10', 'cached payload reused');

  const third = await fetchSeminarScheduleFromGas({ fetchImpl, now: 1_000 + 61_000 });
  assert(fetchCount === 2, 'cache TTL expiry → refetch');
  assert(third.ok !== false, 'refetch still maps payload');

  process.env.SEMINAR_SCHEDULE_GAS_URL = '';
  __testResetSeminarScheduleCache();
  try {
    await fetchSeminarScheduleFromGas({ fetchImpl });
    assert(false, 'missing GAS URL should throw');
  } catch (e) {
    assert(e.status === 503, 'missing GAS URL → 503');
  }

  process.env.SEMINAR_SCHEDULE_GAS_URL = prev;
  __testResetSeminarScheduleCache();
}

console.log('\n=== API source contract ===\n');
{
  const api = readFileSync(new URL('../api/seminar-schedule.js', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../lab_manager.html', import.meta.url), 'utf8');

  assert(api.includes('withCors'), 'api uses withCors (same helper as students)');
  assert(!api.includes('requireSession'), 'GET seminar-schedule is public (no requireSession)');
  assert(api.includes('fetchSeminarScheduleFromGas'), 'GET uses GAS helper (no Neon)');
  assert(api.includes('query `t=`') || api.includes('t='), 't= documented as unused by handler');
  assert(!/searchParams.*\bt\b/.test(api), 'handler does not read query t');

  assert(
    !html.includes('/api/seminar-schedule?t='),
    'frontend does not cache-bust with ?t=',
  );
  assert(
    html.includes("fetch(`${base}/api/seminar-schedule`"),
    'frontend fetches stable /api/seminar-schedule URL',
  );
  assert(
    html.includes('既存の日程を表示しています'),
    'frontend failure keeps existing schedule + warning',
  );
  assert(
    html.includes('5 * 60 * 1000'),
    'auto-sync interval is 5 minutes (not tight retry loop)',
  );
}

console.log('\n=== Cross-API CORS reuse ===\n');
{
  const students = readFileSync(new URL('../api/students.js', import.meta.url), 'utf8');
  const daily = readFileSync(new URL('../api/daily-reports.js', import.meta.url), 'utf8');
  const psych = readFileSync(new URL('../api/psych-assessments.js', import.meta.url), 'utf8');
  const seminar = readFileSync(new URL('../api/seminar-schedule.js', import.meta.url), 'utf8');
  assert(students.includes("from '../lib/http.js'"), 'students uses lib/http withCors');
  assert(daily.includes("from '../lib/http.js'"), 'daily-reports uses lib/http withCors');
  assert(psych.includes("from '../lib/http.js'"), 'psych-assessments uses lib/http withCors');
  assert(seminar.includes("from '../lib/http.js'"), 'seminar-schedule uses same withCors');
}

console.log(`\nSeminar schedule: ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
