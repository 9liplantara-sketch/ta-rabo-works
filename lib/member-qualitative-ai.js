/**
 * Phase M3 — AI provider adapter
 *
 * 未設定 → provider disabled（本番で mock 候補が保存されない）
 * mock は test / local development のみ許可
 */

import { QUALITATIVE_PROMPT_VERSION } from './member-qualitative-constants.js';

/** Phase M3: self_report は daily_report 由来のみ（speaker attribution 未実装のため） */
export const SELF_REPORT_ALLOWED_SOURCE_KIND = 'daily_report';

export const AI_SYSTEM_RULES = `
1. self_report は Phase M3 では daily_report 由来のみ。学生本人が日報に明示したことだけ。
2. knowledge_record（meeting_minutes / transcript / one_on_one / interview / admin_note / other）は self_report 不可。
3. knowledge_record から抽出する場合は observed_pattern または ai_hypothesis のみ。
4. 文字起こしに「本人が〜と言った」と書かれていても、speaker identity を DB 上で保証できないため self_report にしない。
5. self_report の supports evidence はすべて daily_report であること。knowledge_record を含む候補は self_report にしない。
6. 例: 管理者メモ「木下さんはガラスが好きそう」→「ガラスが好き」を self_report にしてはならない。
7. 単発の出来事だけで「苦手」「嫌い」「得意」と断定しない。
8. 推測は「〜の可能性」「〜する場面が複数見られる」等の観察ベース表現にする。
9. 医療・精神疾患・発達・政治・宗教・性的指向等のセンシティブ属性推定は禁止。
10. 「能力が低い」「性格が悪い」等の固定的評価ラベルは禁止。
11. 教育・研究指導に役立つ観察と仮説に限定。
12. 出力は必ず JSON。候補は candidate 相当（confirmed にしない）。
`.trim();

export function isProductionEnvironment() {
  if (process.env.VERCEL_ENV === 'production') return true;
  if (process.env.NODE_ENV === 'production') return true;
  return false;
}

export function isMockProviderAllowed() {
  if (isProductionEnvironment()) return false;
  if (process.env.NODE_ENV === 'test') return true;
  if (process.env.MEMBER_ANALYSIS_AI_ALLOW_MOCK === '1') return true;
  if (process.env.MEMBER_ANALYSIS_AI_ALLOW_MOCK === 'true') return true;
  // local development (no Vercel, or Vercel dev)
  if (!process.env.VERCEL_ENV || process.env.VERCEL_ENV === 'development') return true;
  return false;
}

/** 環境変数に設定された provider（未設定なら null = disabled） */
export function getConfiguredAiProvider() {
  const raw = String(process.env.MEMBER_ANALYSIS_AI_PROVIDER || '').trim();
  return raw || null;
}

/** @deprecated use getConfiguredAiProvider */
export function getAiProviderName() {
  return getConfiguredAiProvider();
}

export function resolveAiProviderRuntime() {
  const provider = getConfiguredAiProvider();
  if (!provider) {
    return { status: 'disabled', provider: null, error: 'ai_provider_not_configured' };
  }
  if (provider === 'mock') {
    if (!isMockProviderAllowed()) {
      return { status: 'rejected', provider: 'mock', error: 'ai_provider_not_configured' };
    }
    return { status: 'ready', provider: 'mock', mode: 'sync' };
  }
  if (provider === 'local_worker') {
    return { status: 'ready', provider: 'local_worker', mode: 'queue' };
  }
  return { status: 'ready', provider, mode: 'sync' };
}

export function isQueueBasedProvider(provider) {
  return provider === 'local_worker';
}

export function assertAiProviderReadyForAnalysis() {
  const resolved = resolveAiProviderRuntime();
  if (resolved.status !== 'ready') {
    const err = new Error(resolved.error);
    err.status = 503;
    err.code = resolved.error;
    throw err;
  }
  return resolved.provider;
}

export function assertSyncAiProviderForExecution() {
  const resolved = resolveAiProviderRuntime();
  if (resolved.status !== 'ready') {
    const err = new Error(resolved.error);
    err.status = 503;
    err.code = resolved.error;
    throw err;
  }
  if (isQueueBasedProvider(resolved.provider)) {
    const err = new Error('local_worker_does_not_run_on_server');
    err.status = 500;
    err.code = 'local_worker_does_not_run_on_server';
    throw err;
  }
  return resolved.provider;
}

export function validateSelfReportProvenance(epistemicType, evidence, _sourceMetaByKey = null) {
  if (epistemicType !== 'self_report') {
    return { ok: true, errors: [] };
  }

  const errors = [];
  const items = Array.isArray(evidence) ? evidence : [];
  const supports = items.filter((ev) => {
    const role = String(ev.evidence_role || ev.evidenceRole || 'supports').trim();
    return role === 'supports';
  });

  if (!supports.length) {
    errors.push('self_report requires at least one supports evidence');
    return { ok: false, errors };
  }

  for (const ev of supports) {
    const kind = String(ev.source_kind || ev.sourceKind || '').trim();
    if (kind === 'daily_report') continue;
    if (kind === 'knowledge_record') {
      errors.push('self_report forbidden: knowledge_record supports evidence not allowed in Phase M3');
    } else {
      errors.push(`self_report supports evidence must be daily_report (got ${kind || 'unknown'})`);
    }
  }

  return { ok: errors.length === 0, errors };
}

export function buildStep1Prompt(sources) {
  const payload = JSON.stringify(sources, null, 2);
  return `あなたは研究室の教員向けアシスタントです。以下は学生の日報・研究室記録です（定量アンケート結果はまだ与えません）。

${AI_SYSTEM_RULES}

記録から以下を抽出してください:
- 明示された興味・好み・苦手・得意
- 継続行動・モチベーション・目標・最近の変化

JSON形式:
{
  "observations": [
    {
      "category": "interest|preference|aversion|strength|difficulty|work_style|communication|motivation|goal|concern|recent_change|other",
      "statement": "...",
      "epistemic_type": "self_report|observed_pattern|ai_hypothesis",
      "confidence": "low|medium|high",
      "relation_type": "new|reinforce|contradict|possible_supersede",
      "related_item_id": null,
      "evidence": [
        { "source_kind": "daily_report|knowledge_record", "source_id": "uuid", "evidence_role": "supports" }
      ]
    }
  ]
}

入力ソース:
${payload}`;
}

export function buildStep2Prompt(step1Observations, existingProfile, psychScores) {
  return `Step1で日報・記録のみから得た観察:
${JSON.stringify(step1Observations, null, 2)}

既存の確定 qualitative profile（参考）:
${JSON.stringify(existingProfile, null, 2)}

定量 psych_assessment スコア（参考のみ・断定禁止・スコア変更禁止）:
${JSON.stringify(psychScores || {}, null, 2)}

${AI_SYSTEM_RULES}

定量スコアに合わせて日報を都合よく解釈しないこと。日報観察を主とし、スコアは照合用参考値。

最終候補を JSON:
{
  "candidates": [ ... same shape as observations ... ]
}`;
}

export function validateAiCandidate(candidate, allowedSourceKeys, sourceMetaByKey = null) {
  const errors = [];
  if (!candidate || typeof candidate !== 'object') {
    return { ok: false, errors: ['candidate must be object'] };
  }
  const category = String(candidate.category || '').trim();
  const statement = String(candidate.statement || '').trim();
  const epistemic = String(candidate.epistemic_type || candidate.epistemicType || '').trim();
  const confidence = String(candidate.confidence || '').trim();

  if (!category) errors.push('category required');
  if (!statement) errors.push('statement required');
  if (!epistemic) errors.push('epistemic_type required');
  if (!confidence) errors.push('confidence required');

  if (epistemic === 'self_report' && /可能性|かもしれ|推測|仮説/.test(statement)) {
    errors.push('self_report cannot contain hypothesis phrasing');
  }

  const evidence = Array.isArray(candidate.evidence) ? candidate.evidence : [];
  if (!evidence.length) errors.push('evidence required');

  for (const ev of evidence) {
    const kind = String(ev.source_kind || ev.sourceKind || '').trim();
    const sid = String(ev.source_id || ev.sourceId || '').trim();
    const key = `${kind}:${sid}`;
    if (!allowedSourceKeys.has(key)) {
      errors.push(`invalid evidence source: ${key}`);
    }
  }

  if (sourceMetaByKey && epistemic === 'self_report') {
    const prov = validateSelfReportProvenance(epistemic, evidence, sourceMetaByKey);
    if (!prov.ok) errors.push(...prov.errors);
  }

  return { ok: errors.length === 0, errors };
}

export function validateAiOutput(output, allowedSourceKeys, sourceMetaByKey = null) {
  const candidates = Array.isArray(output?.candidates)
    ? output.candidates
    : (Array.isArray(output?.observations) ? output.observations : []);

  const valid = [];
  const rejected = [];

  for (const c of candidates) {
    const v = validateAiCandidate(c, allowedSourceKeys, sourceMetaByKey);
    if (v.ok) valid.push(c);
    else rejected.push({ candidate: c, errors: v.errors });
  }

  return { valid, rejected, candidates: valid };
}

function resolveMockEpistemicType(src, text) {
  const kind = src.source_kind || src.sourceKind;
  const hasSelfLanguage = /好き|楽しい|面白|困|苦手/.test(text);

  if (kind === 'daily_report') {
    return hasSelfLanguage && /好き|楽しい/.test(text) ? 'self_report' : 'observed_pattern';
  }
  // Phase M3: knowledge_record は speaker attribution 未実装のため self_report 不可
  if (kind === 'knowledge_record') {
    return 'observed_pattern';
  }
  return 'observed_pattern';
}

/** Mock AI: test / local development のみ（assertAiProviderReadyForAnalysis 経由） */
export function mockAiTwoStageAnalysis({ sources, existingProfile, psychScores }) {
  const observations = [];
  const keywords = [
    { re: /ガラス|透明/, category: 'interest', stmt: '透明素材への関心が継続している可能性がある' },
    { re: /好き|楽しい|面白/, category: 'preference', stmt: '特定の制作活動への好意的な反応が見られる' },
    { re: /困|難しい|苦手|不安/, category: 'difficulty', stmt: '制作・研究において困難を感じている場面がある' },
    { re: /うまく|できた|進/, category: 'strength', stmt: '取り組みが進んでいる場面が複数見られる' },
    { re: /次|目標|やる/, category: 'goal', stmt: '次に取り組むことについて言及がある' },
  ];

  for (const src of sources || []) {
    const text = String(src.body_text || src.bodyText || '');
    for (const kw of keywords) {
      if (!kw.re.test(text)) continue;
      observations.push({
        category: kw.category,
        statement: kw.stmt,
        epistemic_type: resolveMockEpistemicType(src, text),
        confidence: 'medium',
        relation_type: 'new',
        related_item_id: null,
        evidence: [{
          source_kind: src.source_kind || src.sourceKind,
          source_id: src.source_id || src.sourceId,
          evidence_role: 'supports',
        }],
      });
      break;
    }
  }

  if (!observations.length && sources?.length) {
    const s0 = sources[0];
    observations.push({
      category: 'other',
      statement: '記録から追加の観察候補を抽出するには、より多くの共有記録が必要な可能性がある',
      epistemic_type: 'ai_hypothesis',
      confidence: 'low',
      relation_type: 'new',
      related_item_id: null,
      evidence: [{
        source_kind: s0.source_kind || s0.sourceKind,
        source_id: s0.source_id || s0.sourceId,
        evidence_role: 'supports',
      }],
    });
  }

  return {
    step1: { observations },
    step2: { candidates: observations },
    model_provider: 'mock',
    model_name: 'mock-m3-v1',
    prompt_version: QUALITATIVE_PROMPT_VERSION,
    psych_reference_used: !!psychScores,
    existing_profile_count: (existingProfile || []).length,
  };
}

export async function runQualitativeAiAnalysis(ctx) {
  const provider = assertSyncAiProviderForExecution();
  if (provider === 'mock') {
    return mockAiTwoStageAnalysis(ctx);
  }
  const err = new Error(
    `MEMBER_ANALYSIS_AI_PROVIDER=${provider} は未実装です。vendor adapter を追加してください。`,
  );
  err.status = 501;
  err.code = 'ai_provider_not_implemented';
  throw err;
}

export function fingerprintSources(sources) {
  const keys = (sources || [])
    .map((s) => `${s.sourceKind || s.source_kind}:${s.sourceId || s.source_id}`)
    .sort();
  return keys.join('|');
}
