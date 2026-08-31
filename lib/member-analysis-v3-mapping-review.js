/**
 * NEEDS_REVIEW Proposal 行の人間確認資料生成
 */

import {
  normalizeMappingText,
} from './member-analysis-v3-form-mapping.js';

export const REVIEW_CSV_COLUMNS = [
  'form_order',
  'google_item_id',
  'row_index',
  'proposed_item_id',
  'scope',
  'instrument',
  'response_type',
  'Form文言',
  'master description',
  'normalized Form文言',
  'normalized master文言',
  'match_method',
  'match_confidence',
  'wording_category',
  'block_name',
  'block_sequence_ok',
  'prev_item_id',
  'next_item_id',
  'response_type_ok',
  'mismatch_summary',
  'recommended_action',
  'human_review',
];

const BLOCK_BY_PREFIX = [
  { name: 'ACK', prefix: 'ACK-', ids: ['ACK-01', 'ACK-02', 'ACK-03'] },
  { name: 'ADM', prefix: 'ADM-', ids: ['ADM-01', 'ADM-02', 'ADM-03'] },
  { name: 'CAP', prefix: 'CAP-', ids: ['CAP-01'] },
  { name: 'EXP', prefix: 'EXP-', ids: ['EXP-01', 'EXP-02', 'EXP-03', 'EXP-04', 'EXP-05'] },
  { name: 'INT', prefix: 'INT-', ids: ['INT-01', 'INT-02', 'INT-03', 'INT-04', 'INT-05'] },
  { name: 'LAB', prefix: 'LAB-', ids: ['LAB-01'] },
  { name: 'SEED', prefix: 'SEED-', ids: ['SEED-01', 'SEED-02', 'SEED-03', 'SEED-04', 'SEED-05'] },
  { name: 'Big Five', prefix: 'B5-', ids: null },
  { name: 'Values', prefix: 'VAL-', ids: null },
  { name: 'VSNAP', prefix: 'VSNAP-', ids: ['VSNAP-01'] },
  { name: 'RF', prefix: 'RF-', ids: null },
  { name: 'RIASEC', prefix: 'RIA-', ids: null },
  { name: 'JDG', prefix: 'JDG-', ids: ['JDG-01', 'JDG-02', 'JDG-03', 'JDG-04', 'JDG-05', 'JDG-06', 'JDG-07', 'JDG-08'] },
  {
    name: 'FUT',
    prefix: 'FUT-',
    ids: ['FUT-01', 'FUT-02', 'FUT-03', 'FUT-ANX1', 'FUT-EXP1', 'FUT-LS1', 'FUT-04', 'FUT-05'],
  },
  { name: 'META', prefix: 'META-', ids: ['META-01', 'META-02'] },
  { name: 'SCH', prefix: 'SCH-', ids: ['SCH-01', 'SCH-02'] },
];

const PROMPT_SUFFIXES = [
/を(?:すべて)?選(?:択|んで)ください$/,
/を(?:すべて)?選択してください$/,
/を入力してください$/,
/を書(?:い)?てください$/,
/を教えてください$/,
/があれば教えてください$/,
/があれば(?:自由に)?書(?:い)?てください$/,
/について(?:教えてください|書(?:い)?てください)$/,
/どの程度[^？?]*[？?]?$/,
/はどの程度[^？?]*[？?]?$/,
/はありますか[？?]?$/,
/ですか[？?]?$/,
];

/** @param {string} text */
function stripFormPromptTail(text) {
  let s = normalizeMappingText(text);
  for (const re of PROMPT_SUFFIXES) {
    s = s.replace(re, '').trim();
  }
  return s;
}

/** @param {string} itemId */
function blockNameForItemId(itemId) {
  for (const block of BLOCK_BY_PREFIX) {
    if (itemId.startsWith(block.prefix)) return block.name;
  }
  return '';
}

/**
 * @param {object} proposalRow
 * @param {object[]} allProposals
 */
function analyzeBlockSequence(proposalRow, allProposals) {
  const block = BLOCK_BY_PREFIX.find((b) => proposalRow.proposed_item_id.startsWith(b.prefix));
  if (!block || !block.ids) {
    return { blockName: blockNameForItemId(proposalRow.proposed_item_id), blockSequenceOk: 'n/a' };
  }

  const blockProposals = allProposals.filter((p) => block.ids.includes(p.proposed_item_id));
  const ordered = block.ids.map((id) => blockProposals.find((p) => p.proposed_item_id === id));
  const formOrders = ordered.map((p) => Number(p?.form_order || 0));
  const monotonic = formOrders.every((v, i) => i === 0 || v > formOrders[i - 1]);
  const complete = ordered.every(Boolean) && ordered.length === block.ids.length;

  return {
    blockName: block.name,
    blockSequenceOk: complete && monotonic ? 'yes' : 'no',
  };
}

function responseTypesCompatible(formType, masterType) {
  const map = {
    multi_choice: 'checkbox',
    checkbox: 'checkbox',
    grid: 'grid_scale',
    paragraph: 'paragraph',
    scale: 'scale',
    text: 'text',
    dropdown: 'dropdown',
  };
  return (map[formType] || formType) === masterType;
}

/** @param {string} a @param {string} b */
function charBigramOverlapRatio(shorter, longer) {
  const s = shorter.length <= longer.length ? shorter : longer;
  const l = shorter.length <= longer.length ? longer : shorter;
  if (s.length < 4) return l.includes(s) ? 1 : 0;
  let hit = 0;
  let total = 0;
  for (let i = 0; i < s.length - 1; i++) {
    const bg = s.slice(i, i + 2);
    total += 1;
    if (l.includes(bg)) hit += 1;
  }
  return total ? hit / total : 0;
}

/** @param {string} master @param {string} form */
function masterCorePresentInForm(master, form) {
  const nm = normalizeMappingText(master);
  const nf = stripFormPromptTail(form);
  if (!nm) return false;
  if (nf.includes(nm) || nm.includes(nf)) return true;

  const chunks = nm.split(/[・、。]/).map((s) => s.trim()).filter((s) => s.length >= 3);
  if (chunks.length >= 2) {
    const matched = chunks.filter((chunk) => nf.includes(chunk));
    if (matched.length >= Math.ceil(chunks.length * 0.6)) return true;
  }

  return charBigramOverlapRatio(nm, nf) >= 0.45;
}

/**
 * @param {object} row
 * @returns {'A'|'B'|'C'|'D'}
 */
export function classifyWordingCategory(row) {
  const formText = row.row_index !== '' ? row.row_label : row.source_header;
  const masterText = row.description;
  const normForm = normalizeMappingText(formText);
  const normMaster = normalizeMappingText(masterText);
  const strippedForm = stripFormPromptTail(formText);
  const strippedMaster = stripFormPromptTail(masterText);

  if (row.row_index !== '' && row.instrument) {
    return 'D';
  }

  if (normForm === normMaster || strippedForm === strippedMaster || strippedForm === normMaster) {
    return 'A';
  }

  if (strippedForm.includes(strippedMaster) || strippedMaster.includes(strippedForm)) {
    return 'B';
  }

  if (normForm.includes(normMaster) || normMaster.includes(normForm)) {
    return 'B';
  }

  if (masterCorePresentInForm(masterText, formText)) {
    return 'B';
  }

  // ORDER_STRUCTURAL + block/response_type OK → Form長文化として扱う（意味推測確定ではない）
  if (
    row.match_method === 'ORDER_STRUCTURAL'
    && row.response_type_ok !== false
    && row.block_sequence_ok !== 'no'
  ) {
    return 'B';
  }

  return 'C';
}

/**
 * @param {object} row
 * @param {'A'|'B'|'C'|'D'} category
 */
export function recommendAction(row, category) {
  if (category === 'D') return 'FIX_FORM_TEXT';
  if (category === 'C') return 'NEEDS_MANUAL_CHECK';
  if (category === 'A' || category === 'B') {
    if (row.block_sequence_ok === 'no') return 'NEEDS_MANUAL_CHECK';
    if (!row.response_type_ok) return 'NEEDS_MANUAL_CHECK';
    return 'ACCEPT_STRUCTURAL';
  }
  return 'NEEDS_MANUAL_CHECK';
}

/** @param {object} row @param {'A'|'B'|'C'|'D'} category */
function buildMismatchSummary(row, category) {
  const formText = row.row_index !== '' ? row.row_label : row.source_header;
  const parts = [];
  if (category === 'A') parts.push('正規化後は表記差のみ');
  if (category === 'B') parts.push('Form側が質問文として長文化・言い換え');
  if (category === 'C') parts.push('意味対応にニュアンス差の可能性');
  if (category === 'D') parts.push('尺度Grid row_labelがmaster descriptionと不一致（master正本）');
  if (!row.response_type_ok) {
    parts.push(`response_type不一致: form=${row.response_type}, master=${row.master_response_type}`);
  }
  if (row.block_sequence_ok === 'no') parts.push('block内form_order/master順序に異常');
  if (normalizeMappingText(formText) !== normalizeMappingText(row.description)) {
    parts.push('normalized文言非一致');
  }
  return parts.join('; ');
}

/** @param {object} row @param {string} action */
function humanReviewNote(row, category, action) {
  if (action === 'FIX_FORM_TEXT') {
    return 'Form修正後にMapping更新・Proposal再生成（master wording正本）';
  }
  if (action === 'NEEDS_MANUAL_CHECK') {
    return '内容を読んで対応可否を判断';
  }
  if (action === 'ACCEPT_STRUCTURAL') {
    return category === 'A' ? '表記差のみ—構造対応で可' : '意味同一の長文化—構造対応で可';
  }
  return '';
}

/**
 * @param {object[]} proposals
 */
export function buildReviewRows(proposals) {
  const needsReview = proposals.filter((p) => p.review_status === 'NEEDS_REVIEW');
  const byOrder = [...proposals].sort((a, b) => Number(a.form_order) - Number(b.form_order));

  return needsReview.map((row) => {
    const idx = byOrder.findIndex((p) => p.proposed_item_id === row.proposed_item_id);
    const prev = idx > 0 ? byOrder[idx - 1].proposed_item_id : '';
    const next = idx >= 0 && idx < byOrder.length - 1 ? byOrder[idx + 1].proposed_item_id : '';
    const formText = row.row_index !== '' ? row.row_label : row.source_header;
    const { blockName, blockSequenceOk } = analyzeBlockSequence(row, proposals);
    const responseTypeOk = responseTypesCompatible(row.response_type, row.master_response_type);
    const category = classifyWordingCategory({
      ...row,
      response_type_ok: responseTypeOk,
      block_sequence_ok: blockSequenceOk,
    });
    const enriched = {
      ...row,
      block_name: blockName,
      block_sequence_ok: blockSequenceOk,
      response_type_ok: responseTypeOk,
    };
    const recommendedAction = recommendAction(enriched, category);

    return {
      form_order: row.form_order,
      google_item_id: row.google_item_id,
      row_index: row.row_index,
      proposed_item_id: row.proposed_item_id,
      scope: row.scope,
      instrument: row.instrument || '',
      response_type: row.response_type,
      'Form文言': formText,
      'master description': row.description,
      'normalized Form文言': normalizeMappingText(formText),
      'normalized master文言': normalizeMappingText(row.description),
      match_method: row.match_method,
      match_confidence: row.match_confidence,
      wording_category: category,
      block_name: blockName,
      block_sequence_ok: blockSequenceOk,
      prev_item_id: prev,
      next_item_id: next,
      response_type_ok: responseTypeOk ? 'yes' : 'no',
      mismatch_summary: buildMismatchSummary(enriched, category),
      recommended_action: recommendedAction,
      human_review: humanReviewNote(enriched, category, recommendedAction),
    };
  });
}

/** @param {ReturnType<typeof buildReviewRows>} reviewRows */
export function reviewRowsToCsv(reviewRows) {
  const lines = [REVIEW_CSV_COLUMNS.join(',')];
  for (const row of reviewRows) {
    lines.push(REVIEW_CSV_COLUMNS.map((col) => csvEscape(row[col] ?? '')).join(','));
  }
  return `${lines.join('\n')}\n`;
}

function csvEscape(value) {
  const s = String(value ?? '');
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** @param {ReturnType<typeof buildReviewRows>} reviewRows @param {object} blockAudit */
export function reviewRowsToMarkdown(reviewRows, blockAudit) {
  const lines = [
    '# 2026 v3 Mapping Proposal — NEEDS_REVIEW 人間確認資料',
    '',
    '> 暫定 fixture ベース。Sheet 再 export 後に Proposal / 本資料を再生成すること。',
    '',
    '## サマリー',
    '',
  ];

  const counts = { A: 0, B: 0, C: 0, D: 0 };
  const actions = {};
  for (const row of reviewRows) {
    counts[row.wording_category] = (counts[row.wording_category] || 0) + 1;
    actions[row.recommended_action] = (actions[row.recommended_action] || 0) + 1;
  }

  lines.push(`- NEEDS_REVIEW total: **${reviewRows.length}**`);
  lines.push(`- A 表記差: **${counts.A || 0}**`);
  lines.push(`- B 長文化: **${counts.B || 0}**`);
  lines.push(`- C 意味差: **${counts.C || 0}**`);
  lines.push(`- D 尺度文言差: **${counts.D || 0}**`);
  lines.push('');
  lines.push('### recommended_action');
  for (const [k, v] of Object.entries(actions).sort()) {
    lines.push(`- ${k}: **${v}**`);
  }
  lines.push('');
  lines.push('## Block 構造整合性（非Grid / 全Proposal）');
  lines.push('');
  for (const b of blockAudit) {
    lines.push(`- **${b.block}**: master順=${b.masterIds.join(' → ')} / block_sequence_ok=${b.ok}${b.note ? ` — ${b.note}` : ''}`);
  }
  lines.push('');
  lines.push('## Form修正必要（master wording 正本）');
  lines.push('');
  lines.push('詳細: [member-analysis-v3-form-text-fixes.md](./member-analysis-v3-form-text-fixes.md)');
  lines.push('');
  lines.push('| item_id | 対応 |');
  lines.push('|---------|------|');
  lines.push('| VAL-BE2 | Form row_label を master 「…大切にしたい人だ。」に合わせる |');
  lines.push('');
  lines.push('## 人間が内容を読む必要がある項目');
  lines.push('');

  const mustRead = reviewRows.filter(
    (r) => r.recommended_action === 'NEEDS_MANUAL_CHECK' || r.recommended_action === 'FIX_FORM_TEXT',
  );
  if (!mustRead.length) {
    lines.push('（なし — すべて ACCEPT_STRUCTURAL 可能）');
  } else {
    for (const row of mustRead) {
      lines.push(`### ${row.proposed_item_id} (${row.recommended_action})`);
      lines.push('');
      lines.push(`- form_order: ${row.form_order}`);
      lines.push(`- category: ${row.wording_category}`);
      lines.push(`- block: ${row.block_name} (sequence_ok=${row.block_sequence_ok})`);
      lines.push(`- prev/next: ${row.prev_item_id || '—'} / ${row.next_item_id || '—'}`);
      lines.push('');
      lines.push('**Form:**');
      lines.push('');
      lines.push(`> ${String(row['Form文言']).replace(/\n/g, ' ')}`);
      lines.push('');
      lines.push('**master:**');
      lines.push('');
      lines.push(`> ${row['master description']}`);
      lines.push('');
      lines.push(`**mismatch_summary:** ${row.mismatch_summary}`);
      lines.push('');
    }
  }

  lines.push('## 全 NEEDS_REVIEW 一覧');
  lines.push('');
  lines.push('| form_order | item_id | cat | action | block | seq |');
  lines.push('|------------|---------|-----|--------|-------|-----|');
  for (const row of reviewRows) {
    lines.push(
      `| ${row.form_order} | ${row.proposed_item_id} | ${row.wording_category} | ${row.recommended_action} | ${row.block_name} | ${row.block_sequence_ok} |`,
    );
  }
  lines.push('');

  return lines.join('\n');
}

/** @param {object[]} proposals */
export function auditBlockStructure(proposals) {
  const results = [];
  for (const block of BLOCK_BY_PREFIX) {
    if (!block.ids) continue;
    const rows = block.ids.map((id) => proposals.find((p) => p.proposed_item_id === id)).filter(Boolean);
    const formOrders = rows.map((r) => Number(r.form_order));
    const monotonic = formOrders.every((v, i) => i === 0 || v > formOrders[i - 1]);
    const complete = rows.length === block.ids.length;
    results.push({
      block: block.name,
      masterIds: block.ids,
      formOrders,
      ok: complete && monotonic ? 'yes' : 'no',
      note: !complete ? `missing ${block.ids.length - rows.length}` : (!monotonic ? 'form_order not monotonic' : ''),
    });
  }
  return results;
}

export { REVIEW_CSV_COLUMNS as MEMBER_ANALYSIS_V3_REVIEW_CSV_COLUMNS };
