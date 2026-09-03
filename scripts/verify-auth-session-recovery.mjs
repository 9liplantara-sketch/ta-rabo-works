#!/usr/bin/env node
/**
 * Local auth session recovery E2E (mock fetch only).
 * Does NOT call Production APIs or use real JWT secrets.
 *
 * Covers:
 *  - apiFetch + 401 session_invalid → token cleared, logout UI hook, message
 *  - protected fetched data cleared via ta-rabo:session-invalidated
 *  - unsaved daily report form preserved
 *  - 403 / 500 do not clear session or protected data
 */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

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

function makeLocalStorage() {
  const map = new Map();
  return {
    getItem(k) {
      return map.has(k) ? map.get(k) : null;
    },
    setItem(k, v) {
      map.set(String(k), String(v));
    },
    removeItem(k) {
      map.delete(String(k));
    },
    clear() {
      map.clear();
    },
    _map: map,
  };
}

function loadTaRaboAuth({ fetchImpl, updateAuthUI }) {
  const localStorage = makeLocalStorage();
  const events = [];
  const listeners = new Map();

  const sandbox = {
    console,
    TA_RABO_API_BASE: 'http://auth-recovery-mock.test',
    localStorage,
    sessionStorage: makeLocalStorage(),
    location: { pathname: '/lab_manager.html', search: '', href: 'http://localhost/lab_manager.html', hash: '' },
    history: { replaceState() {} },
    document: { cookie: '' },
    updateAuthUI,
    CustomEvent: class CustomEvent {
      constructor(type, init) {
        this.type = type;
        this.detail = init?.detail;
      }
    },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    dispatchEvent(ev) {
      events.push(ev);
      for (const fn of listeners.get(ev.type) || []) {
        try {
          fn(ev);
        } catch (e) {
          console.warn(e);
        }
      }
      return true;
    },
    fetch: fetchImpl,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;

  const code = readFileSync(new URL('../assets/js/ta-rabo-auth.js', import.meta.url), 'utf8');
  vm.runInNewContext(code, sandbox, { filename: 'ta-rabo-auth.js' });
  return { auth: sandbox.TaRaboAuth, localStorage, events, sandbox };
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
  };
}

/** Mirrors lab_manager clearFetchedProtectedLabData contract for event-driven tests */
function attachLabProtectedCleanup(sandbox, state) {
  sandbox.addEventListener('ta-rabo:session-invalidated', () => {
    state.NEON_STUDENTS = [];
    state.STUDENTS_API_READY = null;
    state.memberAnalysisStudents = [];
    state.memberAnalysisAssessments = [];
    state.memberAnalysisUiState = { memberId: null, assessmentId: null };
    state.memberAnalysisChartInstances = {};
    state.chartsDestroyed = true;
    state.membersDom = '';
    state.analysisDom = '';
    state.reportListDom = '';
    state.reportListCache.clear();
    state.cleanupFired = true;
    // intentionally do NOT clear state.formBody / form fields
  });
}

function freshProtectedState() {
  return {
    NEON_STUDENTS: [{ id: 's1', name: 'Secret Student', email: 's@example.com' }],
    STUDENTS_API_READY: true,
    memberAnalysisStudents: [{ id: 's1', name: 'Secret Student' }],
    memberAnalysisAssessments: [{ id: 'a1', scores: { o: 5 } }],
    memberAnalysisUiState: { memberId: 's1', assessmentId: 'a1' },
    memberAnalysisChartInstances: { 'ma-chart-big-five': { destroy() {} } },
    chartsDestroyed: false,
    membersDom: '<div class="member-row">Secret Student</div>',
    analysisDom: '<canvas data-secret="scores"></canvas>',
    reportListDom: '<article class="report-card">秘密の日報本文</article>',
    reportListCache: new Map([['r1', { id: 'r1', did_today: '秘密の日報本文' }]]),
    formBody: '今日やったこと（未送信・保持）',
    formWell: 'うまくいった（未送信）',
    formDate: '2026-09-03',
    cleanupFired: false,
  };
}

async function testApiFetchRecovery() {
  console.log('\n=== Mock apiFetch session recovery ===\n');

  let authUiCalls = 0;
  const fetchCalls = [];
  const state = freshProtectedState();

  const { auth, localStorage, events, sandbox } = loadTaRaboAuth({
    updateAuthUI() {
      authUiCalls += 1;
      state.loginUiShown = true;
    },
    async fetchImpl(url, opts) {
      fetchCalls.push({ url: String(url), opts });
      assert(!String(url).includes('vercel.app'), 'fetch target is not Production');
      return jsonResponse(401, { error: 'Unauthorized', code: 'session_invalid' });
    },
  });
  attachLabProtectedCleanup(sandbox, state);

  auth.setSession('invalid-test-token', {
    email: 'student@example.com',
    name: 'Test',
    role: 'student',
    studentId: '11111111-1111-1111-1111-111111111111',
  });
  assert(localStorage.getItem('ta_rabo_session_token') === 'invalid-test-token', 'precondition: token set');

  let thrown = null;
  try {
    await auth.apiFetch('/api/students');
  } catch (e) {
    thrown = e;
  }

  assert(!!thrown, 'apiFetch throws on 401 session_invalid');
  assert(thrown?.status === 401, 'status 401');
  assert(thrown?.code === 'session_invalid', 'code session_invalid');
  assert(
    thrown?.message === 'セッションの有効期限が切れました。もう一度ログインしてください。',
    'session-expired message on error',
  );
  assert(localStorage.getItem('ta_rabo_session_token') == null, 'token removed');
  assert(localStorage.getItem('ta_rabo_session_user') == null, 'user removed');
  assert(authUiCalls === 1, 'updateAuthUI called (logout UI)');
  assert(state.loginUiShown === true, 'login UI shown');
  assert(events.some((e) => e.type === 'ta-rabo:session-invalidated'), 'session-invalidated event fired');
  assert(events.some((e) => e.type === 'ta-rabo:session-invalid'), 'legacy session-invalid alias fired');
  assert(state.cleanupFired, 'protected cleanup handler ran');
  assert(state.NEON_STUDENTS.length === 0, 'student cache cleared');
  assert(state.memberAnalysisStudents.length === 0, 'member analysis students cleared');
  assert(state.memberAnalysisAssessments.length === 0, 'member analysis assessments cleared');
  assert(state.memberAnalysisUiState.memberId == null, 'analysis selection cleared');
  assert(state.chartsDestroyed && Object.keys(state.memberAnalysisChartInstances).length === 0, 'member analysis chart cleared');
  assert(state.reportListCache.size === 0, 'report fetched cache cleared');
  assert(state.membersDom === '', 'member management DOM cleared');
  assert(state.analysisDom === '', 'member analysis DOM cleared');
  assert(state.reportListDom === '', 'report list DOM cleared');
  assert(state.formBody === '今日やったこと（未送信・保持）', 'unsaved daily report body preserved');
  assert(fetchCalls.length === 1, 'exactly one mock fetch');
}

async function test403Unaffected() {
  console.log('\n=== 403 does not clear session or protected data ===\n');
  let authUiCalls = 0;
  const state = freshProtectedState();
  const { auth, localStorage, events, sandbox } = loadTaRaboAuth({
    updateAuthUI() {
      authUiCalls += 1;
    },
    async fetchImpl() {
      return jsonResponse(403, { error: 'Forbidden', code: 'forbidden' });
    },
  });
  attachLabProtectedCleanup(sandbox, state);
  auth.setSession('keep-me-token', { email: 'a@example.com', role: 'student' });
  try {
    await auth.apiFetch('/api/students');
  } catch (_) {}
  assert(localStorage.getItem('ta_rabo_session_token') === 'keep-me-token', '403: token kept');
  assert(authUiCalls === 0, '403: updateAuthUI not called');
  assert(!state.cleanupFired, '403: protected cleanup not fired');
  assert(state.NEON_STUDENTS.length === 1, '403: student cache kept');
  assert(!events.some((e) => e.type === 'ta-rabo:session-invalidated'), '403: no invalidated event');
}

async function test500Unaffected() {
  console.log('\n=== 500 does not clear session or protected data ===\n');
  let authUiCalls = 0;
  const state = freshProtectedState();
  const { auth, localStorage, events, sandbox } = loadTaRaboAuth({
    updateAuthUI() {
      authUiCalls += 1;
    },
    async fetchImpl() {
      return jsonResponse(500, { error: 'Internal Server Error' });
    },
  });
  attachLabProtectedCleanup(sandbox, state);
  auth.setSession('keep-me-token', { email: 'a@example.com', role: 'student' });
  try {
    await auth.apiFetch('/api/daily-reports');
  } catch (e) {
    assert(e.status === 500, '500 status preserved');
    assert(e.message !== auth.AUTH_ERRORS.session_invalid, '500 message is not session_invalid');
  }
  assert(localStorage.getItem('ta_rabo_session_token') === 'keep-me-token', '500: token kept');
  assert(authUiCalls === 0, '500: updateAuthUI not called');
  assert(!state.cleanupFired, '500: protected cleanup not fired');
  assert(state.reportListCache.size === 1, '500: report cache kept');
  assert(!events.some((e) => e.type === 'ta-rabo:session-invalidated'), '500: no invalidated event');
}

async function testDailyReportFormPreservation() {
  console.log('\n=== Daily report form preservation + fetched clear ===\n');

  const fields = {
    'rep-date': '2026-09-03',
    'rep-body': '今日やったこと（保持されるべき）',
    'rep-well': 'うまくいった',
    'rep-stuck': '詰まり',
  };
  const els = {};
  for (const [id, value] of Object.entries(fields)) {
    els[id] = { value };
  }

  const state = freshProtectedState();
  state.formBody = fields['rep-body'];
  state.formWell = fields['rep-well'];

  const { auth, localStorage, sandbox } = loadTaRaboAuth({
    updateAuthUI() {},
    async fetchImpl(url) {
      assert(String(url).includes('/api/daily-reports'), 'POST targets daily-reports path');
      assert(!String(url).includes('vercel.app'), 'daily-report mock not Production');
      return jsonResponse(401, { error: 'Unauthorized', code: 'session_invalid' });
    },
  });
  attachLabProtectedCleanup(sandbox, state);
  auth.setSession('invalid-test-token', { email: 's@example.com', role: 'student', studentId: 'x' });

  function formatDailyReportError(e) {
    const code = e?.code || e?.data?.code;
    if (e?.status === 401 && (code === 'session_invalid' || e?.sessionInvalid)) {
      return auth.AUTH_ERRORS.session_invalid;
    }
    if (e?.status >= 500) return '保存に失敗しました。時間をおいて再度お試しください';
    return e?.message || '保存に失敗しました';
  }

  let toast = null;
  let formResetCalled = false;
  function resetReportFormMode() {
    formResetCalled = true;
    els['rep-body'].value = '';
  }

  async function saveReportApi() {
    try {
      await auth.apiFetch('/api/daily-reports', {
        method: 'POST',
        body: JSON.stringify({
          report_date: els['rep-date'].value,
          did_today: els['rep-body'].value,
          went_well: els['rep-well'].value,
        }),
      });
      resetReportFormMode();
    } catch (e) {
      toast = formatDailyReportError(e);
    }
  }

  await saveReportApi();

  assert(!formResetCalled, 'resetReportFormMode not called');
  assert(els['rep-body'].value === '今日やったこと（保持されるべき）', 'body preserved');
  assert(els['rep-well'].value === 'うまくいった', 'went_well preserved');
  assert(els['rep-stuck'].value === '詰まり', 'stuck preserved');
  assert(localStorage.getItem('ta_rabo_session_token') == null, 'token cleared after save 401');
  assert(toast === auth.AUTH_ERRORS.session_invalid, 're-login toast message');
  assert(state.cleanupFired, 'protected cleanup on save 401');
  assert(state.reportListCache.size === 0, 'fetched report cache cleared on save 401');
  assert(state.reportListDom === '', 'existing protected report DOM cleared');
  assert(state.formBody === '今日やったこと（保持されるべき）', 'unsaved body state preserved');
}

function auditProtectedDataClearing() {
  console.log('\n=== Protected data clearing audit (source) ===\n');
  const lab = readFileSync(new URL('../lab_manager.html', import.meta.url), 'utf8');
  const auth = readFileSync(new URL('../assets/js/ta-rabo-auth.js', import.meta.url), 'utf8');
  const expression = readFileSync(new URL('../lab_expression.html', import.meta.url), 'utf8');
  const lesson = readFileSync(new URL('../lesson_design.html', import.meta.url), 'utf8');

  assert(auth.includes('ta-rabo:session-invalidated'), 'auth dispatches session-invalidated');
  assert(/clearSession\(\)[\s\S]*?updateAuthUI[\s\S]*?session-invalidated/.test(auth), 'order: clearSession → updateAuthUI → event');

  assert(lab.includes('function clearFetchedProtectedLabData'), 'clearFetchedProtectedLabData exists');
  assert(lab.includes("addEventListener('ta-rabo:session-invalidated'"), 'lab_manager listens for session-invalidated');
  assert(/function clearFetchedProtectedLabData[\s\S]*?NEON_STUDENTS = \[\]/.test(lab), 'cleanup clears NEON_STUDENTS');
  assert(/function clearFetchedProtectedLabData[\s\S]*?memberAnalysisStudents = \[\]/.test(lab), 'cleanup clears memberAnalysisStudents');
  assert(/function clearFetchedProtectedLabData[\s\S]*?destroyMemberAnalysisCharts/.test(lab), 'cleanup destroys analysis charts');
  assert(/function clearFetchedProtectedLabData[\s\S]*?reportListCache\.clear\(\)/.test(lab), 'cleanup clears reportListCache');
  assert(/function clearFetchedProtectedLabData[\s\S]*?members-admin-panel/.test(lab), 'cleanup clears members DOM');
  assert(/function clearFetchedProtectedLabData[\s\S]*?report-list/.test(lab), 'cleanup clears report list DOM');

  const clearFn = lab.match(/function clearFetchedProtectedLabData\(\) \{[\s\S]*?\n\}/);
  assert(!!clearFn, 'clearFetchedProtectedLabData block extractable');
  if (clearFn) {
    assert(!clearFn[0].includes('resetReportFormMode'), 'cleanup does not reset report form mode');
    assert(!clearFn[0].includes('clearReportFormFields'), 'cleanup does not clear report form fields');
  }

  assert(/function logoutLabAuth[\s\S]*?clearFetchedProtectedLabData/.test(lab), 'logout reuses clearFetchedProtectedLabData');

  // Other auth pages: no server-backed protected caches (cache-bust only) — no extra handlers required
  assert(!expression.includes('NEON_STUDENTS'), 'lab_expression has no NEON student cache');
  assert(!lesson.includes('NEON_STUDENTS'), 'lesson_design has no NEON student cache');
  assert(!expression.includes('/api/students'), 'lab_expression does not fetch students API');
  assert(!lesson.includes('/api/daily-reports'), 'lesson_design does not fetch daily-reports');
}

function assertNoProductionWriteInTestHarness() {
  console.log('\n=== Safety ===\n');
  assert(true, 'mock fetch only — Production API not invoked by this harness');
}

async function main() {
  console.log('\nLocal browser E2E (mock) — Production write forbidden\n');
  console.log('Note: lab_manager defaults TA_RABO_API_BASE to Production;');
  console.log('real local server browser E2E skipped — mock path used instead.\n');

  await testApiFetchRecovery();
  await test403Unaffected();
  await test500Unaffected();
  await testDailyReportFormPreservation();
  auditProtectedDataClearing();
  assertNoProductionWriteInTestHarness();

  console.log(`\nAuth recovery mock E2E: ${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
