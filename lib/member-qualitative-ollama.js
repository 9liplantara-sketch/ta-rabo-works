/**
 * Phase M3-L — Ollama adapter（Local Worker のみ。テストでは mock 差し替え可）
 */

import {
  OLLAMA_DEFAULT_URL,
  OLLAMA_DEFAULT_MODEL,
  OLLAMA_DEFAULT_TEMPERATURE,
  OLLAMA_DEFAULT_NUM_CTX,
  OLLAMA_DEFAULT_KEEP_ALIVE,
  OLLAMA_DEFAULT_TIMEOUT_MS,
  OLLAMA_DEFAULT_PRESENCE_PENALTY,
  OLLAMA_CONTEXT_SAFETY_MARGIN,
  VALID_CATEGORIES,
  VALID_EPISTEMIC_TYPES,
  CONFIDENCE_LEVELS,
  RELATION_TYPES,
} from './member-qualitative-constants.js';
import {
  AI_SYSTEM_RULES,
  buildStep1Prompt,
  buildStep2Prompt,
} from './member-qualitative-ai.js';
import { filterStep2Candidates } from './member-qualitative-worker.js';

export const CANDIDATES_JSON_SCHEMA = {
  type: 'object',
  properties: {
    candidates: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          category: { type: 'string', enum: VALID_CATEGORIES },
          statement: { type: 'string' },
          epistemic_type: { type: 'string', enum: VALID_EPISTEMIC_TYPES },
          confidence: { type: 'string', enum: CONFIDENCE_LEVELS },
          relation_type: { type: 'string', enum: RELATION_TYPES },
          related_item_id: { type: 'string', nullable: true },
          evidence: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                source_kind: { type: 'string', enum: ['daily_report', 'knowledge_record'] },
                source_id: { type: 'string' },
                evidence_role: { type: 'string', enum: ['supports', 'contradicts'] },
              },
              required: ['source_kind', 'source_id', 'evidence_role'],
            },
          },
        },
        required: ['category', 'statement', 'epistemic_type', 'confidence', 'relation_type', 'evidence'],
      },
    },
  },
  required: ['candidates'],
};

export const STEP1_JSON_SCHEMA = {
  type: 'object',
  properties: {
    observations: {
      type: 'array',
      items: CANDIDATES_JSON_SCHEMA.properties.candidates.items,
    },
  },
  required: ['observations'],
};

function parsePositiveInt(raw, fallback) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

export function getOllamaConfig() {
  return {
    baseUrl: String(process.env.MEMBER_ANALYSIS_OLLAMA_URL || OLLAMA_DEFAULT_URL).replace(/\/$/, ''),
    model: String(process.env.MEMBER_ANALYSIS_OLLAMA_MODEL || OLLAMA_DEFAULT_MODEL).trim(),
    temperature: Number(process.env.MEMBER_ANALYSIS_OLLAMA_TEMPERATURE ?? OLLAMA_DEFAULT_TEMPERATURE),
    numCtx: parsePositiveInt(process.env.MEMBER_ANALYSIS_OLLAMA_NUM_CTX, OLLAMA_DEFAULT_NUM_CTX),
    presencePenalty: Number(process.env.MEMBER_ANALYSIS_OLLAMA_PRESENCE_PENALTY ?? OLLAMA_DEFAULT_PRESENCE_PENALTY),
    keepAlive: String(process.env.MEMBER_ANALYSIS_OLLAMA_KEEP_ALIVE || OLLAMA_DEFAULT_KEEP_ALIVE).trim(),
    timeoutMs: parsePositiveInt(process.env.MEMBER_ANALYSIS_OLLAMA_TIMEOUT_MS, OLLAMA_DEFAULT_TIMEOUT_MS),
    contextSafetyMargin: OLLAMA_CONTEXT_SAFETY_MARGIN,
  };
}

export function buildOllamaChatRequestBody({
  systemPrompt,
  userPrompt,
  schema,
  config = getOllamaConfig(),
}) {
  return {
    model: config.model,
    stream: false,
    format: schema,
    keep_alive: config.keepAlive,
    options: {
      temperature: Number.isFinite(config.temperature) ? config.temperature : OLLAMA_DEFAULT_TEMPERATURE,
      num_ctx: config.numCtx,
      presence_penalty: Number.isFinite(config.presencePenalty)
        ? config.presencePenalty
        : OLLAMA_DEFAULT_PRESENCE_PENALTY,
    },
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  };
}

export function extractOllamaResponseMeta(data) {
  return {
    prompt_eval_count: data?.prompt_eval_count ?? null,
    eval_count: data?.eval_count ?? null,
    total_duration: data?.total_duration ?? null,
    load_duration: data?.load_duration ?? null,
    done_reason: data?.done_reason ?? null,
  };
}

export function isValidPromptEvalCount(promptEvalCount) {
  return Number.isFinite(promptEvalCount) && promptEvalCount > 0;
}

export function assertOllamaPromptEvalCountPresent(meta) {
  const count = meta?.prompt_eval_count;
  if (!isValidPromptEvalCount(count)) {
    const err = new Error('ollama_prompt_token_count_missing');
    err.code = 'ollama_prompt_token_count_missing';
    err.meta = meta;
    throw err;
  }
}

export function assertOllamaGenerationComplete(data) {
  const doneReason = data?.done_reason;
  if (doneReason == null || doneReason === '') return;
  if (String(doneReason) !== 'stop') {
    const err = new Error('ollama_incomplete_generation');
    err.code = 'ollama_incomplete_generation';
    err.done_reason = doneReason;
    throw err;
  }
}

export function isOllamaContextLimitReached(promptEvalCount, numCtx, safetyMargin = OLLAMA_CONTEXT_SAFETY_MARGIN) {
  if (!isValidPromptEvalCount(promptEvalCount)) return false;
  if (!Number.isFinite(numCtx) || numCtx <= 0) return false;
  return promptEvalCount >= (numCtx - safetyMargin);
}

export function assertOllamaContextCapacity(meta, config = getOllamaConfig()) {
  assertOllamaPromptEvalCountPresent(meta);
  const count = meta.prompt_eval_count;
  if (isOllamaContextLimitReached(count, config.numCtx, config.contextSafetyMargin)) {
    const err = new Error('ollama_context_limit_reached');
    err.code = 'ollama_context_limit_reached';
    err.meta = meta;
    throw err;
  }
}

export async function checkOllamaAvailability(fetchImpl = fetch) {
  const { baseUrl } = getOllamaConfig();
  try {
    const res = await fetchImpl(`${baseUrl}/api/tags`, { method: 'GET' });
    return res.ok;
  } catch {
    return false;
  }
}

export async function callOllamaStructured({
  systemPrompt,
  userPrompt,
  schema,
  fetchImpl = fetch,
  config = getOllamaConfig(),
  stepLabel = 'step',
}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const body = buildOllamaChatRequestBody({ systemPrompt, userPrompt, schema, config });
    const res = await fetchImpl(`${config.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const err = new Error(`ollama_http_${res.status}`);
      err.code = 'ollama_unavailable';
      err.step = stepLabel;
      throw err;
    }

    const data = await res.json();
    const meta = extractOllamaResponseMeta(data);
    assertOllamaPromptEvalCountPresent(meta);
    assertOllamaGenerationComplete(data);
    assertOllamaContextCapacity(meta, config);

    const raw = data?.message?.content;
    if (!raw) {
      const err = new Error('invalid_model_output');
      err.code = 'invalid_model_output';
      err.step = stepLabel;
      throw err;
    }

    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return { parsed, meta, step: stepLabel };
  } catch (e) {
    if (e.name === 'AbortError') {
      const err = new Error('ollama_timeout');
      err.code = 'ollama_timeout';
      err.step = stepLabel;
      throw err;
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export async function runOllamaTwoStageAnalysis(job, deps = {}) {
  const fetchImpl = deps.fetchImpl || fetch;
  const callStructured = deps.callOllamaStructured || callOllamaStructured;
  const config = deps.config || getOllamaConfig();

  const sources = job.sources || [];

  const step1Prompt = buildStep1Prompt(sources);
  const step1Result = await callStructured({
    systemPrompt: AI_SYSTEM_RULES,
    userPrompt: step1Prompt,
    schema: STEP1_JSON_SCHEMA,
    fetchImpl,
    config,
    stepLabel: 'step1',
  });

  const observations = Array.isArray(step1Result.parsed?.observations)
    ? step1Result.parsed.observations
    : [];

  const step2Prompt = buildStep2Prompt(
    observations,
    job.existing_confirmed_profile || [],
    job.psych_assessment?.scores || null,
  );

  const step2Result = await callStructured({
    systemPrompt: AI_SYSTEM_RULES,
    userPrompt: step2Prompt,
    schema: CANDIDATES_JSON_SCHEMA,
    fetchImpl,
    config,
    stepLabel: 'step2',
  });

  const step2Candidates = Array.isArray(step2Result.parsed?.candidates)
    ? step2Result.parsed.candidates
    : [];
  const filtered = filterStep2Candidates(observations, step2Candidates);
  const candidates = filtered.length ? filtered : observations;

  return {
    structured_result: { candidates },
    model: config.model,
    prompt_version: job.prompt_version,
    step1_observation_count: observations.length,
    step2_candidate_count: candidates.length,
    ollama_meta: {
      num_ctx: config.numCtx,
      step1: step1Result.meta,
      step2: step2Result.meta,
    },
  };
}

/** テスト用 mock */
export function mockOllamaTwoStageAnalysis(job) {
  const src = (job.sources || [])[0];
  const candidate = {
    category: 'interest',
    statement: '記録から継続的な関心が見られる',
    epistemic_type: 'observed_pattern',
    confidence: 'medium',
    relation_type: 'new',
    related_item_id: null,
    evidence: src ? [{
      source_kind: src.source_kind,
      source_id: src.source_id,
      evidence_role: 'supports',
    }] : [],
  };
  return {
    structured_result: { candidates: candidate.evidence.length ? [candidate] : [] },
    model: 'mock-ollama',
    prompt_version: job.prompt_version,
    step1_observation_count: 1,
    step2_candidate_count: candidate.evidence.length ? 1 : 0,
    ollama_meta: {
      num_ctx: OLLAMA_DEFAULT_NUM_CTX,
      step1: { prompt_eval_count: 100, eval_count: 50 },
      step2: { prompt_eval_count: 120, eval_count: 40 },
    },
  };
}
