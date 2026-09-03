/**
 * 研究室定量アンケート v1 — 設問ヘッダー mapping
 * 正本: 価値観分析フォーム（回答）Google Sheet（2026 監査済み）
 *
 * scales.*.traits.*.items[].header = exact header 文字列（比較時は trim 正規化）
 */
export const QUESTIONNAIRE_VERSION = 'member-analysis-2026-v1';
export const SCORING_VERSION = 'member-analysis-score-v1';

/** @param {string} header @param {boolean} [reverse] */
function q(header, reverse = false) {
  return { header, reverse };
}

/** @type {import('./member-analysis-scoring.js').QuestionnaireConfig} */
export const MEMBER_ANALYSIS_QUESTIONNAIRE_V1 = {
  questionnaire_version: QUESTIONNAIRE_VERSION,
  scoring_version: SCORING_VERSION,
  meta: {
    timestampHeaders: ['タイムスタンプ'],
    /** 現 Sheet には無し。Google Form でメール収集を有効化した場合に自動認識（email 完全一致 → name） */
    emailHeaders: ['メールアドレス', 'Email Address'],
    nameHeaders: ['Q1. 氏名（必須）'],
  },
  syncColumnHeaders: [
    'member_analysis_sync_id',
    'member_analysis_sync_status',
    'member_analysis_synced_at',
    'member_analysis_sync_hash',
    'member_analysis_sync_error',
    'member_analysis_response_schema',
    'member_analysis_source_layout_hash',
  ],
  /**
   * 定性分析用（Qualitative Insights）。採点しないが raw_answers / hash に含める。
   */
  contextualHeaders: [
    'Q2. 研究室で扱ってみたいテーマ（仮でOK）（記述：短文）',
    'Q3. いまの体調/余裕度（0〜10：スライダー）',
    'Q4. 高校〜大学までで「時間を使ってきたこと」をできるだけ多く',
    'Q5. その中で「楽しかった／苦じゃなかった」こと＋理由',
    'Q6. 逆に「しんどかった／合わなかった」こと＋理由',
    'Q7. 続けられた理由（環境・習慣・仲間・報酬など）（任意）',
    'Q8. 最近つい見てしまう／調べてしまうもの',
    'Q9. 「よく分からないけど惹かれる」テーマ',
    'Q10. 「あまり興味が持てない」もの（長文）',
    'Q11. 直近3ヶ月で“熱が上がった/下がった”関心があれば（任意）',
    'Q12. 何かを選ぶとき無意識に重視していそうなこと（記述）',
    'Q13. 価値観スナップショット（複数選択）',
    'Q14. 卒業後を考えるときの気持ち',
    'Q15. 理想的な生活イメージ（記述）',
    'Q16. 避けたい働き方（記述）',
    'Q17. 不安/期待の強さ',
    '面談希望日を入力ください',
  ],
  /** 採点対象外（旧フォーム obsolete）。raw_answers / hash には残す */
  scoreExcludeHeaders: [
    '抽象的な話は苦手だ 2',
    'コツコツ型の事務・管理も苦ではない 2',
    '回避（Prevention）',
  ],
  /** raw_answers / hash からも除外する legacy 列 */
  rawExcludeHeaders: [
    '列 94',
  ],
  pendingAudit: [],
  scales: {
    bigFive: {
      label: 'BIG FIVE',
      min: 1,
      max: 7,
      reverseTransform: 'eight_minus',
      traits: {
        extraversion: {
          items: [
            q('人と話すとエネルギーが湧きやすい'),
            q('初対面でもわりと話しかけられる'),
            q('一人の時間がないと消耗する', true),
            q('大人数の場は疲れやすい', true),
          ],
        },
        conscientiousness: {
          items: [
            q('締切や約束は守るほうだ'),
            q('準備してから動くことが多い'),
            q('つい先延ばしにしてしまう', true),
            q('整理整頓や段取りが苦手だ', true),
          ],
        },
        agreeableness: {
          items: [
            q('相手の立場を考えて言い方を選ぶ'),
            q('衝突より調整を選びがちだ'),
            q('競争では相手を押しのけても勝ちたい', true),
            q('つい人を疑ってしまう', true),
          ],
        },
        emotionalStability: {
          items: [
            q('心配事が頭から離れにくい', true),
            q('失敗を引きずりやすい', true),
            q('気持ちは切り替えが早い'),
            q('プレッシャー下でも平常心に近い'),
          ],
        },
        openness: {
          items: [
            q('新しい概念や表現にワクワクする'),
            q('未知の分野を学ぶのが好きだ'),
            q('いつも通りが一番落ち着く', true),
            q('抽象的な話は苦手だ', true),
          ],
        },
      },
    },
    riasec: {
      label: 'RIASEC',
      min: 1,
      max: 5,
      reverseTransform: null,
      traits: {
        R: {
          items: [
            q('道具・機材を使って試作や加工をする'),
            q('現場で手を動かして改善する'),
            q('機械・構造・素材の扱いを覚えて使いこなす'),
            q('フィジカルな作業の精度を上げる'),
          ],
        },
        I: {
          items: [
            q('なぜそうなるかを仮説→検証したい'),
            q('データや根拠を集めて筋道を立てたい'),
            q('仕組みを分解して理解するのが好き'),
            q('新しい知識を体系化して説明したい'),
          ],
        },
        A: {
          items: [
            q('作品や表現として形にしたい'),
            q('感覚や世界観を大事にして作りたい'),
            q('既存の枠を崩すアイデアを出したい'),
          ],
        },
        S: {
          items: [
            q('誰かの成長や理解を助けたい'),
            q('対話しながら一緒に答えを作りたい'),
            q('相手の困りごとを聞いて整理したい'),
            q('チームや仲間の安心を優先したい'),
          ],
        },
        E: {
          items: [
            q('人を巻き込み企画を前に進めたい'),
            q('交渉や提案で物事を動かしたい'),
            q('価値を言語化して外に発信したい'),
            q('成果やインパクトを狙って意思決定したい'),
          ],
        },
        C: {
          items: [
            q('手順化・運用設計・管理が得意になりたい'),
            q('情報を整理してミスなく回すことが好き'),
            q('ルールやフォーマットを作って整える'),
            q('コツコツ型の事務・管理も苦ではない'),
          ],
        },
      },
    },
    schwartz: {
      label: 'SCHWARTZ 10',
      min: 1,
      max: 6,
      reverseTransform: null,
      traits: {
        selfDirection: {
          items: [
            q('自分なりのやり方で考え、工夫して進めたい人だ'),
            q('ルールよりも納得感を大事にして決めたい人だ'),
          ],
        },
        stimulation: {
          items: [
            q('変化や新鮮さがないと退屈に感じやすい人だ'),
            q('少し怖くても新しい挑戦に惹かれる人だ'),
          ],
        },
        hedonism: {
          items: [
            q('好き/楽しいという感覚を優先したい人だ'),
            q('心地よさや気分の良さを大事にしたい人だ'),
          ],
        },
        achievement: {
          items: [
            q('目標を達成して実力を示したい人だ'),
            q('「できる人」と見られることがモチベーションになる人だ'),
          ],
        },
        power: {
          items: [
            q('影響力や主導権を持つことに価値を感じる人だ'),
            q('地位や収入など“強さの指標”を大事にしたい人だ'),
          ],
        },
        security: {
          items: [
            q('先が読めること、安定していることを大事にする人だ'),
            q('リスクを減らして確実に進めたい人だ'),
          ],
        },
        conformity: {
          items: [
            q('周りに迷惑をかけないよう自分を抑えることがある人だ'),
            q('決まりごとや手順を守るのが基本だと思う人だ'),
          ],
        },
        tradition: {
          items: [
            q('昔からのやり方や文化を尊重したい人だ'),
            q('「当たり前」や礼儀を大切にしたい人だ'),
          ],
        },
        benevolence: {
          items: [
            q('身近な人の役に立つことが嬉しい人だ'),
            q('チームや仲間の安心を優先したい人だ'),
          ],
        },
        universalism: {
          items: [
            q('公平さや弱い立場への配慮を重視する人だ'),
            q('環境や社会全体にとって良いかを考えたい人だ'),
          ],
        },
      },
    },
    regulatoryFocus: {
      label: '制御焦点',
      min: 1,
      max: 7,
      reverseTransform: null,
      traits: {
        promotion: {
          items: [
            q('成功や成長のイメージが先に立つ'),
            q('うまくいったときの達成感が次の行動を押す'),
            q('多少の失敗は投資だと思える'),
            q('「得られるもの」を考えると動きやすい'),
            q('夢中になると一気に加速する'),
          ],
        },
        prevention: {
          items: [
            q('ミスや損失を避けるために慎重に進める'),
            q('ルールや期待を外すことが気になる'),
            q('先にリスクを潰してから動きたい'),
            q('「失敗しないこと」が行動の軸になりやすい'),
            q('責任を負う場面では緊張が強くなる'),
          ],
        },
      },
    },
  },
};

export function isQuestionnaireMappingReady(config = MEMBER_ANALYSIS_QUESTIONNAIRE_V1) {
  for (const scale of Object.values(config.scales || {})) {
    for (const trait of Object.values(scale.traits || {})) {
      if (!Array.isArray(trait.items) || trait.items.length === 0) return false;
    }
  }
  return true;
}

/** 採点 config に登録された header 一覧（監査用） */
export function getScoringHeadersFromConfig(config = MEMBER_ANALYSIS_QUESTIONNAIRE_V1) {
  const headers = [];
  for (const scale of Object.values(config.scales || {})) {
    for (const trait of Object.values(scale.traits || {})) {
      for (const item of trait.items || []) {
        if (item?.header) headers.push(item.header);
      }
    }
  }
  return headers;
}

/** scale ごとの設問数 */
export function getScoringItemCounts(config = MEMBER_ANALYSIS_QUESTIONNAIRE_V1) {
  const counts = {};
  for (const [scaleKey, scale] of Object.entries(config.scales || {})) {
    let total = 0;
    const byTrait = {};
    for (const [traitKey, trait] of Object.entries(scale.traits || {})) {
      const n = (trait.items || []).length;
      byTrait[traitKey] = n;
      total += n;
    }
    counts[scaleKey] = { total, byTrait };
  }
  return counts;
}

/** @deprecated use scoreExcludeHeaders */
export function getScoreExcludeHeaders(config = MEMBER_ANALYSIS_QUESTIONNAIRE_V1) {
  return config.scoreExcludeHeaders || [];
}

