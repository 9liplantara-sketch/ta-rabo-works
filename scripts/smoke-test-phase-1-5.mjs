#!/usr/bin/env node
/**
 * Phase 1.5 本番 Smoke Test
 *
 * 使い方:
 *   # health + migration のみ
 *   DATABASE_URL='postgresql://...' node scripts/smoke-test-phase-1-5.mjs
 *
 *   # API 権限テスト（lab_manager でログイン後、DevTools → Application → session token）
 *   API_BASE=https://ta-rabo-works.vercel.app \
 *   TOKEN_STUDENT_A=... TOKEN_STUDENT_B=... TOKEN_ADMIN=... \
 *   node scripts/smoke-test-phase-1-5.mjs
 *
 *   # migration 未適用時に index を作成（明示 opt-in）
 *   APPLY_MIGRATION=1 DATABASE_URL='...' node scripts/smoke-test-phase-1-5.mjs
 */
const API_BASE = (process.env.API_BASE || 'https://ta-rabo-works.vercel.app').replace(/\/$/, '');

let passed = 0;
let failed = 0;
let skipped = 0;

function ok(label) { passed += 1; console.log(`  ✓ ${label}`); }
function fail(label, detail = '') { failed += 1; console.error(`  ✗ ${label}${detail ? `: ${detail}` : ''}`); }
function skip(label) { skipped += 1; console.log(`  ○ skip ${label}`); }

async function apiFetch(path, token, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

console.log('\n=== Phase 1.5 Smoke Test ===\n');
console.log(`API_BASE: ${API_BASE}\n`);

// --- 1. Health ---
console.log('--- Health ---');
try {
  const { res, data } = await apiFetch('/api/health');
  if (!res.ok || !data.ok) fail('health ok', JSON.stringify(data));
  else ok('health ok / db connected');
  if ('has_daily_reports_search_index' in data) {
    if (data.has_daily_reports_search_index) ok('has_daily_reports_search_index = true');
    else fail('has_daily_reports_search_index = false', data.migration_hint || '');
  } else {
    fail('has_daily_reports_search_index フィールドなし — Phase 1.5 API 未デプロイ');
  }
} catch (e) {
  fail('health request', e.message);
}

// --- 2. Migration (Neon) ---
console.log('\n--- Migration ---');
const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  skip('Neon index 確認 (DATABASE_URL 未設定)');
} else {
  const { neon } = await import('@neondatabase/serverless');
  const sql = neon(dbUrl);
  const idx = await sql`
    SELECT indexname FROM pg_indexes
    WHERE tablename = 'daily_reports'
      AND indexname = 'idx_daily_reports_student_date'
  `;
  if (idx.length > 0) {
    ok('idx_daily_reports_student_date 存在');
  } else if (process.env.APPLY_MIGRATION === '1') {
    await sql`
      CREATE INDEX IF NOT EXISTS idx_daily_reports_student_date
      ON daily_reports (student_email, report_date DESC, created_at DESC)
    `;
    const again = await sql`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'daily_reports'
        AND indexname = 'idx_daily_reports_student_date'
    `;
    if (again.length > 0) ok('migration 適用成功');
    else fail('migration 適用後も index なし');
  } else {
    fail('idx_daily_reports_student_date 未存在', 'APPLY_MIGRATION=1 で適用可能');
  }
}

// --- 3. API shape (unauthenticated) ---
console.log('\n--- API shape ---');
{
  const { res, data } = await apiFetch('/api/daily-reports?view=mine&limit=1');
  if (res.status === 401) ok('未認証 GET → 401');
  else fail('未認証 GET', `status ${res.status}`);
  if (res.status !== 401) {
    if ('has_more' in data) ok('レスポンスに has_more');
    else fail('has_more なし — 旧 API');
  }
}

// --- 4. Authenticated tests ---
const tokenA = process.env.TOKEN_STUDENT_A;
const tokenB = process.env.TOKEN_STUDENT_B;
const tokenAdmin = process.env.TOKEN_ADMIN;

async function listReports(token, qs = 'view=mine&limit=50') {
  const { res, data } = await apiFetch(`/api/daily-reports?${qs}`, token);
  return { res, data, reports: data.reports || [] };
}

async function postReport(token, payload) {
  return apiFetch('/api/daily-reports', token, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

async function patchReport(token, id, payload) {
  return apiFetch(`/api/daily-reports?id=${encodeURIComponent(id)}`, token, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

console.log('\n--- 認証 API（トークン設定時）---');
if (!tokenA) {
  skip('学生A テスト (TOKEN_STUDENT_A 未設定)');
} else {
  const today = new Date().toISOString().slice(0, 10);
  const marker = `SMOKE_P15_${Date.now()}`;

  // 同日2件 POST
  const p1 = await postReport(tokenA, {
    report_date: today,
    did_today: `${marker} first`,
    visibility: 'private',
  });
  const p2 = await postReport(tokenA, {
    report_date: today,
    did_today: `${marker} second`,
    visibility: 'lab',
  });
  if (p1.res.status === 201 && p2.res.status === 201 && p1.data.report?.id !== p2.data.report?.id) {
    ok('同日2件 POST（別 ID）');
  } else {
    fail('同日2件 POST', `status ${p1.res.status}/${p2.res.status}`);
  }

  const idLab = p2.data.report?.id;

  // キーワード特殊文字（エラーにならない）
  for (const q of ['%', '_', '\\', marker]) {
    const { res } = await listReports(tokenA, `view=mine&q=${encodeURIComponent(q)}&limit=10`);
    if (res.ok) ok(`検索 q=${JSON.stringify(q)} → ${res.status}`);
    else fail(`検索 q=${JSON.stringify(q)}`, `status ${res.status}`);
  }

  // 期間 inclusive
  const { res: dr, data: dd } = await listReports(
    tokenA,
    `view=mine&from=${today}&to=${today}&q=${encodeURIComponent(marker)}`
  );
  if (dr.ok && dd.reports.length >= 2) ok('期間 from=to=today で両件ヒット');
  else fail('期間検索 inclusive', `count=${dd.reports?.length}`);

  // PATCH timestamp
  if (idLab) {
    const before = p2.data.report;
    await new Promise((r) => setTimeout(r, 1100));
    const { res: pr, data: pd } = await patchReport(tokenA, idLab, {
      did_today: `${marker} second edited`,
    });
    if (pr.ok) {
      const after = pd.report;
      if (after.created_at === before.created_at) ok('PATCH created_at 維持');
      else fail('PATCH created_at 変更', `${before.created_at} → ${after.created_at}`);
      if (after.updated_at && after.updated_at !== before.updated_at) ok('PATCH updated_at 更新');
      else fail('PATCH updated_at 未更新');
    } else fail('PATCH 本人', `status ${pr.status}`);
  }

  // attachments A/B
  if (idLab) {
    const attId = idLab;
    await patchReport(tokenA, attId, {
      attachments: [
        { url: 'https://example.com/a.pdf', type: 'pdf', title: 'A', note: 'n1' },
        { url: 'https://example.com/b.png', type: 'image', title: 'B', note: 'n2' },
      ],
    });
    const { data: d0 } = await apiFetch(`/api/daily-reports?id=${attId}`, tokenA);
    const n0 = (d0.report?.attachments || []).length;
    if (n0 === 2) ok('attachments 2件設定');
    else fail('attachments 2件設定', `got ${n0}`);

    await patchReport(tokenA, attId, { did_today: `${marker} att body only` });
    const { data: dA } = await apiFetch(`/api/daily-reports?id=${attId}`, tokenA);
    if ((dA.report?.attachments || []).length === 2) ok('ケースA: 本文のみ編集で添付維持');
    else fail('ケースA', `attachments=${(dA.report?.attachments || []).length}`);

    await patchReport(tokenA, attId, {
      attachments: [{ url: 'https://example.com/a.pdf', type: 'pdf', title: 'A', note: 'n1' }],
    });
    const { data: dB } = await apiFetch(`/api/daily-reports?id=${attId}`, tokenA);
    if ((dB.report?.attachments || []).length === 1) ok('ケースB: 1件削除');
    else fail('ケースB');

    await patchReport(tokenA, attId, { attachments: [] });
    const { data: dC } = await apiFetch(`/api/daily-reports?id=${attId}`, tokenA);
    if ((dC.report?.attachments || []).length === 0) ok('ケースC: 全削除');
    else fail('ケースC');

    await patchReport(tokenA, attId, {
      attachments: [{ url: 'https://example.com/x.pdf', type: 'pdf', title: 'T1', note: 'N1' }],
    });
    await patchReport(tokenA, attId, {
      attachments: [{ url: 'https://example.com/x.pdf', type: 'pdf', title: 'T2', note: 'N2' }],
    });
    const { data: dD } = await apiFetch(`/api/daily-reports?id=${attId}`, tokenA);
    const a = dD.report?.attachments?.[0];
    if (a?.title === 'T2' && a?.note === 'N2') ok('ケースD: title/note 更新');
    else fail('ケースD', JSON.stringify(a));
  }
}

if (!tokenB) {
  skip('学生B 権限テスト (TOKEN_STUDENT_B 未設定)');
} else if (!tokenA) {
  skip('学生B 権限テスト (学生A 未実行)');
} else {
  const { data: labList } = await listReports(tokenB, 'view=lab&limit=50');
  const { data: mineList } = await listReports(tokenB, 'view=mine&limit=50');
  const privatesFromA = (mineList.reports || []).filter((r) =>
    r.visibility === 'private' && r.student_email !== undefined
  );
  ok('学生B view=lab 取得');

  const { res: allRes } = await listReports(tokenB, 'view=all&limit=5');
  if (allRes.status === 403) ok('学生B view=all → 403');
  else fail('学生B view=all', `status ${allRes.status}`);

  // private 漏洩: lab 検索で private が混ざらない
  const { data: searchLab } = await listReports(tokenB, 'view=lab&q=test&limit=50');
  const leak = (searchLab.reports || []).filter((r) => r.visibility === 'private');
  if (leak.length === 0) ok('学生B lab+検索で private なし');
  else fail('private 漏洩', `${leak.length} 件`);

  if (tokenA) {
    const { data: aMine } = await listReports(tokenA, 'view=mine&limit=5');
    const aPrivate = (aMine.reports || []).find((r) => r.visibility === 'private');
    if (aPrivate?.id) {
      const { res: pf } = await patchReport(tokenB, aPrivate.id, { did_today: 'hack' });
      if (pf.status === 403) ok('学生B → 学生A private PATCH 403');
      else fail('学生B PATCH private', `status ${pf.status}`);
      const { res: gf, data: gd } = await apiFetch(
        `/api/daily-reports?id=${aPrivate.id}`,
        tokenB
      );
      if (gf.status === 403) ok('学生B → 学生A private GET 403');
      else if (gf.ok) fail('学生B GET private 漏洩');
      else ok(`学生B GET private → ${gf.status}`);
    } else skip('学生A private 日報なし');
  }
}

if (!tokenAdmin) {
  skip('admin テスト (TOKEN_ADMIN 未設定)');
} else {
  const { res, data } = await listReports(tokenAdmin, 'view=all&limit=5');
  if (res.ok) ok('admin view=all');
  else fail('admin view=all', `status ${res.status}`);
  if ('has_more' in data) ok('admin レスポンス has_more');
}

// pagination has_more (limit+1)
if (tokenAdmin || tokenA) {
  const tok = tokenAdmin || tokenA;
  const { data } = await listReports(tok, 'view=mine&limit=50&offset=0');
  if ('has_more' in data) {
    ok(`has_more フィールド (${data.has_more})`);
    if (data.reports.length < 50 && data.has_more === false) ok('50件未満で has_more=false');
    else if (data.reports.length === 50 && data.has_more === true) ok('50件+追加ありで has_more=true');
    else if (data.reports.length === 50 && data.has_more === false) ok('50件ちょうどで has_more=false (limit+1)');
    else skip(`pagination 件数=${data.reports.length} has_more=${data.has_more}`);
  }
}

console.log(`\n--- 結果: ${passed} passed, ${failed} failed, ${skipped} skipped ---\n`);
process.exit(failed > 0 ? 1 : 0);
