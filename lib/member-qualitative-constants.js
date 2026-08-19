export const PROFILE_CATEGORIES = {
  interest: '興味・関心',
  preference: '好き・好み',
  aversion: '避ける傾向',
  strength: '得意・強み',
  difficulty: '苦手・困難',
  work_style: '研究・制作スタイル',
  communication: 'コミュニケーション',
  motivation: 'モチベーション',
  goal: '目標',
  concern: '懸念・困りごと',
  recent_change: '最近の変化',
  other: 'その他',
};

export const VALID_CATEGORIES = Object.keys(PROFILE_CATEGORIES);

export const EPISTEMIC_TYPES = {
  self_report: '本人の発言',
  observed_pattern: '観察された傾向',
  ai_hypothesis: 'AI仮説',
};

export const VALID_EPISTEMIC_TYPES = Object.keys(EPISTEMIC_TYPES);

export const CONFIDENCE_LEVELS = ['low', 'medium', 'high'];

export const ITEM_STATUSES = ['candidate', 'confirmed', 'superseded', 'rejected'];

export const RELATION_TYPES = ['new', 'reinforce', 'contradict', 'possible_supersede'];

export const EVIDENCE_SOURCE_KINDS = ['daily_report', 'knowledge_record'];

export const EVIDENCE_ROLES = ['supports', 'contradicts'];

export const RUN_STATUSES = ['pending', 'running', 'completed', 'failed'];

export const QUALITATIVE_PROMPT_VERSION = 'm3-v1';

export const WORKER_MODEL_PROVIDER = 'ollama_local';

export const WORKER_LEASE_SECONDS = 300;

export const WORKER_MAX_ATTEMPTS = 3;

export const WORKER_POLL_INTERVAL_MS_DEFAULT = 45000;

export const OLLAMA_DEFAULT_URL = 'http://127.0.0.1:11434';

export const OLLAMA_DEFAULT_MODEL = 'qwen3.6:35b-a3b';

export const OLLAMA_DEFAULT_TEMPERATURE = 0.1;

export const OLLAMA_DEFAULT_NUM_CTX = 16384;

export const OLLAMA_DEFAULT_KEEP_ALIVE = '10m';

export const OLLAMA_DEFAULT_TIMEOUT_MS = 600000;

export const OLLAMA_DEFAULT_PRESENCE_PENALTY = 0;

export const OLLAMA_CONTEXT_SAFETY_MARGIN = 512;

/** system prompt + schema + STEP2 overhead の概算（chars） */
export const ANALYSIS_PROMPT_OVERHEAD_CHARS = 12000;

export const ANALYSIS_INPUT_MAX_CHARS_DEFAULT = 120000;

export const WORKER_HEARTBEAT_INTERVAL_MS_DEFAULT = 60000;

export const CONFIDENCE_LABELS = {
  low: 'LOW',
  medium: 'MEDIUM',
  high: 'HIGH',
};
