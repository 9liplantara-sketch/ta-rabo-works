/**
 * 本番 questionnaire header 名を使った synthetic 採点 fixture（DEMO のみ）
 * 実在学生の回答値・氏名は含まない。
 */
import {
  getScoringHeadersFromConfig,
  MEMBER_ANALYSIS_QUESTIONNAIRE_V1,
} from './member-analysis-questionnaire-v1.js';
import { filterRawAnswersForSync } from './member-analysis-sheet-headers.js';

/** 全設問 + contextual + obsolete を含む raw_answers（列 94 は除外） */
export function buildSyntheticProductionRawAnswers() {
  const raw = {
    'タイムスタンプ': '2026-01-15 10:00:00',
    'Q1. 氏名（必須）': 'SYNTHETIC DEMO MEMBER',
    // contextual（採点外・raw/hash 対象）
    'Q2. 研究室で扱ってみたいテーマ（仮でOK）（記述：短文）': 'SYNTHETIC THEME',
    'Q3. いまの体調/余裕度（0〜10：スライダー）': 7,
    'Q4. 高校〜大学までで「時間を使ってきたこと」をできるだけ多く': 'SYNTHETIC ACTIVITIES',
    'Q5. その中で「楽しかった／苦じゃなかった」こと＋理由': 'SYNTHETIC POSITIVE',
    'Q6. 逆に「しんどかった／合わなかった」こと＋理由': 'SYNTHETIC NEGATIVE',
    'Q7. 続けられた理由（環境・習慣・仲間・報酬など）（任意）': 'SYNTHETIC REASON',
    'Q8. 最近つい見てしまう／調べてしまうもの': 'SYNTHETIC INTEREST',
    'Q9. 「よく分からないけど惹かれる」テーマ': 'SYNTHETIC MYSTERY',
    'Q10. 「あまり興味が持てない」もの（長文）': 'SYNTHETIC DISINTEREST',
    'Q11. 直近3ヶ月で“熱が上がった/下がった”関心があれば（任意）': 'SYNTHETIC TREND',
    'Q12. 何かを選ぶとき無意識に重視していそうなこと（記述）': 'SYNTHETIC VALUES',
    'Q13. 価値観スナップショット（複数選択）': 'SYNTHETIC SNAPSHOT',
    'Q14. 卒業後を考えるときの気持ち': 'SYNTHETIC GRAD FEELING',
    'Q15. 理想的な生活イメージ（記述）': 'SYNTHETIC IDEAL LIFE',
    'Q16. 避けたい働き方（記述）': 'SYNTHETIC AVOID WORK',
    'Q17. 不安/期待の強さ': 5,
    '面談希望日を入力ください': '2026-02-01',
    // obsolete（採点外・raw snapshot）
    '抽象的な話は苦手だ 2': 3,
    'コツコツ型の事務・管理も苦ではない 2': 2,
    '回避（Prevention）': 4,
    // legacy — filter で除外される
    '列 94': 'SHOULD BE STRIPPED',
  };

  for (const header of getScoringHeadersFromConfig()) {
    if (raw[header] !== undefined) continue;
    if (header === '一人の時間がないと消耗する') raw[header] = 2;
    else if (header === '大人数の場は疲れやすい') raw[header] = 3;
    else if (header === '心配事が頭から離れにくい') raw[header] = 2;
    else if (header.startsWith('道具・') || header.startsWith('なぜそう')) raw[header] = 4;
    else if (header.includes('人だ')) raw[header] = 5;
    else if (header.includes('成功') || header.includes('達成')) raw[header] = 6;
    else if (header.includes('ミス') || header.includes('失敗しない')) raw[header] = 4;
    else raw[header] = 5;
  }

  return raw;
}

/** sync 保存用（legacy / sync 列除外済み） */
export function buildSyntheticFilteredRawAnswers() {
  return filterRawAnswersForSync(buildSyntheticProductionRawAnswers());
}

/** trim キー lookup テスト用 */
export function buildSyntheticRawAnswersWithPaddedKeys() {
  const base = buildSyntheticFilteredRawAnswers();
  const padded = {};
  for (const [k, v] of Object.entries(base)) {
    padded[`  ${k}  `] = v;
  }
  return padded;
}

export { MEMBER_ANALYSIS_QUESTIONNAIRE_V1 };
