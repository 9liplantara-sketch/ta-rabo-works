/**
 * 黒い扉 — 調整可能な時間・品質・学生ゲート定義
 * 視点を中心に等間隔で配置。モデル差し替えは GATES / ACTIVE_GATE_IDS で行う。
 */

export const TIMING = {
  /** 中央捕捉／ホバー後、開き始めるまでの待機（秒） */
  aimHold: 0.8,
  /** 開くのにかける時間（秒）。GLB Open_4_seconds と揃える */
  openDuration: 4.0,
  /** 閉じるのにかける時間（秒） */
  closeDuration: 3.2,
  /** 視線／カーソルが外れてから閉じ始めるまでの猶予（秒） */
  leaveGrace: 1.5,
  /** 開状態になってから「作品を見る」を出す遅延（秒） */
  ctaRevealDelay: 0.35,
  /** PCクリックで扉を中央へ寄せるカメラ移動の基準時間（秒） */
  cameraFocusDuration: 2.1,
  /** 大回り時の上限（秒）。角度に応じて基準〜上限で伸ばす */
  cameraFocusDurationMax: 3.2,
  /** ドラッグ見回しのヨー感度（ラジアン／px） */
  dragYawSensitivity: 0.00215,
  /** ドラッグ見回しのピッチ感度（ラジアン／px） */
  dragPitchSensitivity: 0.00135,
  /** 扉が開ききってから中身が出現し始めるまでの余韻（秒） */
  interiorRevealDelay: 0.12,
};

export const QUALITY = {
  /** devicePixelRatio 上限（負荷に応じて下げる） */
  maxPixelRatio: 2,
  /** 低負荷時の上限 */
  lowMaxPixelRatio: 1.25,
  /** 1基あたりの粒子数（3基合計の負荷を抑える） */
  particleCount: 700,
  /** 低負荷時の1基あたり粒子数 */
  lowParticleCount: 320,
  /** 開いている間に出し続ける黒い光（個/秒） */
  ambientEmitPerSec: 10,
};

/** 視点（カメラ）から各扉までの水平距離（m） */
export const VIEW_RADIUS = 9.6;

/** 2027 一期生共通ラベル */
export const COHORT_2027 = '2027年　1期生';

/** このモジュール基準で models/black-gate 配下の URL を解決（HTML の深さに依存しない） */
const MODEL_BASE = new URL('../../models/black-gate/', import.meta.url);

/**
 * @param {string} rel models/black-gate からの相対パス
 * @returns {string}
 */
export function gateAssetUrl(rel) {
  return new URL(rel.replace(/^\//, ''), MODEL_BASE).href;
}

/**
 * @typedef {object} GateDef
 * @property {string} id
 * @property {string} label 表示名（キーボード・UI）
 * @property {string|null} studentName 学生名。未定なら null
 * @property {string} [cohortLabel] 例: 「2027年　1期生」
 * @property {string} [statusLabel] 1期生の隣に出す属性（例: 「留学生　交換留学生」）
 * @property {string} [workTitle] 扉内に小さく出す作品名など
 * @property {string[]} [imageUrls] 扉内に映すサムネ（先頭から使用。増分登録可）
 * @property {string} modelUrl
 * @property {[number, number, number]} [position]
 * @property {number} [yaw=0] Y回転（ラジアン）
 * @property {number} [viewAngle=0] 視点から見た方位（ラジアン、0=正面）
 * @property {string|null} workUrl 作品紹介URL。未接続なら null
 * @property {string} [workLabel='作品を見る']
 * @property {string} [unlinkedNote] workUrl がないときの説明
 */

/** 視点を中心に、扉がカメラを向くポーズを計算 */
export function poseOnRing(viewAngleRad, radius = VIEW_RADIUS) {
  const x = Math.sin(viewAngleRad) * radius;
  const z = -Math.cos(viewAngleRad) * radius;
  return {
    position: /** @type {[number, number, number]} */ ([x, 0, z]),
    yaw: -viewAngleRad,
    viewAngle: viewAngleRad,
  };
}

/**
 * 登録ゲート定義（配置角度は getActiveGates が個数に応じて等間隔で付与）
 * @type {Omit<GateDef, 'position'|'yaw'|'viewAngle'>[]}
 */
export const GATES = [
  {
    id: 'gate-front',
    label: '正面の扉',
    studentName: '滝本陽也',
    cohortLabel: COHORT_2027,
    imageUrls: [gateAssetUrl('works/takimoto/thumb-max.jpg')],
    modelUrl: gateAssetUrl('black_gate.glb'),
    workUrl: 'https://uramtw.s.gy/shizuishi',
    workLabel: '作品を見る',
  },
  {
    id: 'gate-center',
    label: '中央意匠の扉',
    studentName: '邓 舒帆',
    cohortLabel: COHORT_2027,
    statusLabel: '留学生　交換留学生',
    imageUrls: [],
    modelUrl: gateAssetUrl('black_gate_center.glb'),
    workUrl: null,
    workLabel: '作品を見る',
    unlinkedNote: '作品は準備でき次第リンクします。',
  },
  {
    id: 'gate-right',
    label: '右側意匠の扉',
    studentName: '木下 涼',
    cohortLabel: COHORT_2027,
    imageUrls: [],
    modelUrl: gateAssetUrl('black_gate_right.glb'),
    workUrl: null,
    workLabel: '作品を見る',
    unlinkedNote: '作品は準備でき次第リンクします。',
  },
];

/** 有効にするゲート id（増減しても等間隔＋初期正面ランダムに対応） */
export const ACTIVE_GATE_IDS = ['gate-front', 'gate-center', 'gate-right'];

/** @returns {GateDef[]} */
export function getActiveGates() {
  const set = new Set(ACTIVE_GATE_IDS);
  const list = GATES.filter((g) => set.has(g.id));
  const n = Math.max(1, list.length);
  return list.map((g, i) => {
    const viewAngle = (i / n) * Math.PI * 2;
    return /** @type {GateDef} */ ({
      ...g,
      ...poseOnRing(viewAngle),
    });
  });
}
