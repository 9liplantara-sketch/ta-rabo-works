#!/usr/bin/env node
/**
 * Phase M3-L — Local Qwen Worker
 *
 * Vercel へ poll → claim → Ollama 分析 → submit
 * 本文・secret はログに出さない。
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  checkOllamaAvailability,
  runOllamaTwoStageAnalysis,
  getOllamaConfig,
} from '../lib/member-qualitative-ollama.js';
import { WORKER_POLL_INTERVAL_MS_DEFAULT, WORKER_HEARTBEAT_INTERVAL_MS_DEFAULT } from '../lib/member-qualitative-constants.js';
import { MEMBER_ANALYSIS_WORKER_SECRET_HEADER } from '../lib/member-analysis-worker-auth.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

function loadLocalEnvFile() {
  const envPath = resolve(ROOT, '.env.member-analysis-worker');
  if (!existsSync(envPath)) return;
  const text = readFileSync(envPath, 'utf8');
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

loadLocalEnvFile();

function getConfig() {
  const baseUrl = String(process.env.MEMBER_ANALYSIS_WORKER_BASE_URL || '').replace(/\/$/, '');
  const secret = String(process.env.MEMBER_ANALYSIS_WORKER_SECRET || '').trim();
  const workerId = String(process.env.MEMBER_ANALYSIS_WORKER_ID || 'local-worker').trim();
  const pollMs = Number(process.env.MEMBER_ANALYSIS_WORKER_POLL_MS || WORKER_POLL_INTERVAL_MS_DEFAULT);
  if (!baseUrl) throw new Error('MEMBER_ANALYSIS_WORKER_BASE_URL is required');
  if (!secret) throw new Error('MEMBER_ANALYSIS_WORKER_SECRET is required');
  return {
    baseUrl,
    secret,
    workerId,
    pollMs: Number.isFinite(pollMs) && pollMs >= 5000 ? pollMs : WORKER_POLL_INTERVAL_MS_DEFAULT,
    heartbeatMs: parseHeartbeatMs(),
  };
}

function parseHeartbeatMs() {
  const raw = Number(process.env.MEMBER_ANALYSIS_WORKER_HEARTBEAT_MS || WORKER_HEARTBEAT_INTERVAL_MS_DEFAULT);
  if (!Number.isFinite(raw) || raw < 15000) return WORKER_HEARTBEAT_INTERVAL_MS_DEFAULT;
  return Math.floor(raw);
}

async function workerFetch(config, action, body = {}) {
  const res = await fetch(`${config.baseUrl}/api/psych-assessments?action=${encodeURIComponent(action)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      [MEMBER_ANALYSIS_WORKER_SECRET_HEADER]: config.secret,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `worker_api_${res.status}`);
    err.status = res.status;
    err.code = data.error;
    throw err;
  }
  return data;
}

let shuttingDown = false;

function logSafe(message, meta = {}) {
  const safe = { ...meta };
  delete safe.secret;
  delete safe.body_text;
  console.log(`[member-analysis-worker] ${message}`, Object.keys(safe).length ? safe : '');
}

async function processJob(config, job) {
  const runId = job.run_id;
  const claimToken = job.claim_token;
  const started = Date.now();
  let heartbeatTimer;

  const heartbeat = async () => {
    try {
      await workerFetch(config, 'qualitative-worker-heartbeat', {
        run_id: runId,
        worker_id: config.workerId,
        claim_token: claimToken,
      });
    } catch (e) {
      logSafe('heartbeat failed', { run_id: runId, error: e.code || e.message });
    }
  };

  await heartbeat();
  heartbeatTimer = setInterval(heartbeat, config.heartbeatMs);

  try {
    const ollama = getOllamaConfig();
    logSafe('processing job', {
      run_id: runId,
      source_count: (job.sources || []).length,
      model: ollama.model,
      num_ctx: ollama.numCtx,
    });

    const analysis = await runOllamaTwoStageAnalysis(job);

    if (analysis.ollama_meta) {
      logSafe('ollama step1 complete', {
        run_id: runId,
        step: 'step1',
        prompt_eval_count: analysis.ollama_meta.step1?.prompt_eval_count,
        eval_count: analysis.ollama_meta.step1?.eval_count,
        load_duration: analysis.ollama_meta.step1?.load_duration,
      });
      logSafe('ollama step2 complete', {
        run_id: runId,
        step: 'step2',
        prompt_eval_count: analysis.ollama_meta.step2?.prompt_eval_count,
        eval_count: analysis.ollama_meta.step2?.eval_count,
      });
    }
    const result = await workerFetch(config, 'qualitative-worker-submit', {
      run_id: runId,
      worker_id: config.workerId,
      claim_token: claimToken,
      input_fingerprint: job.input_fingerprint,
      model: analysis.model,
      prompt_version: analysis.prompt_version,
      structured_result: analysis.structured_result,
    });

    logSafe('job completed', {
      run_id: runId,
      duration_ms: Date.now() - started,
      created: result.created_candidates,
      already_completed: result.already_completed || false,
    });
  } catch (e) {
    const errorCode = e.code || 'worker_processing_failed';
    try {
      await workerFetch(config, 'qualitative-worker-fail', {
        run_id: runId,
        worker_id: config.workerId,
        claim_token: claimToken,
        error_code: errorCode,
      });
    } catch (failErr) {
      logSafe('fail report error', { run_id: runId, error: failErr.code || failErr.message });
    }
    logSafe('job failed', { run_id: runId, error: errorCode, duration_ms: Date.now() - started });
  } finally {
    clearInterval(heartbeatTimer);
  }
}

async function pollOnce(config) {
  if (shuttingDown) return;

  const ollamaOk = await checkOllamaAvailability();
  if (!ollamaOk) {
    logSafe('ollama unavailable — skip claim');
    return;
  }

  const claim = await workerFetch(config, 'qualitative-worker-claim', {
    worker_id: config.workerId,
  });

  if (claim.skipped) {
    logSafe('job skipped at claim', { reason: claim.skipped, run_id: claim.run_id });
    return;
  }

  if (!claim.job) {
    logSafe('no pending jobs');
    return;
  }

  await processJob(config, claim.job);
}

async function main() {
  const config = getConfig();
  logSafe('starting', {
    worker_id: config.workerId,
    base_url: config.baseUrl,
    poll_ms: config.pollMs,
    heartbeat_ms: config.heartbeatMs,
    model: getOllamaConfig().model,
    num_ctx: getOllamaConfig().numCtx,
  });

  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    logSafe('shutting down');
    setTimeout(() => process.exit(0), 500);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  while (!shuttingDown) {
    try {
      await pollOnce(config);
    } catch (e) {
      logSafe('poll error', { error: e.code || e.message, status: e.status });
    }
    await new Promise((r) => setTimeout(r, config.pollMs));
  }
}

main().catch((e) => {
  console.error('[member-analysis-worker] fatal:', e.message);
  process.exit(1);
});
