import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { TIMING, QUALITY, VIEW_RADIUS, getActiveGates } from './config.js';
import { GateInstance } from './GateInstance.js';
import { CameraRig } from './CameraRig.js';

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarsePointer = window.matchMedia('(pointer: coarse)').matches;
const saveData = !!(navigator.connection && navigator.connection.saveData);
const lowPower =
  saveData ||
  (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4) ||
  (navigator.deviceMemory && navigator.deviceMemory <= 4);

const ui = {
  status: document.getElementById('status'),
  stage: document.getElementById('stage'),
  motionPrompt: document.getElementById('motion-prompt'),
};

/** @type {GateInstance[]} */
let gates = [];
let disposed = false;
let raf = 0;
let hoverGateId = null;
let pointerNdc = new THREE.Vector2(2, 2);
let lastHoverSample = false;

const clock = new THREE.Clock();
const raycaster = new THREE.Raycaster();
const centerNdc = new THREE.Vector2(0, 0);

const renderer = new THREE.WebGLRenderer({
  antialias: !lowPower,
  alpha: false,
  powerPreference: lowPower ? 'low-power' : 'default',
});
const maxPR = lowPower ? QUALITY.lowMaxPixelRatio : QUALITY.maxPixelRatio;
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxPR));
const SPACE = 0xffffff;
renderer.setClearColor(SPACE, 1);
renderer.shadowMap.enabled = !lowPower;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
ui.stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(SPACE);
// 白い奥行きが続くように、遠くまでゆっくり溶けるフォグ
scene.fog = new THREE.Fog(SPACE, 14, 55);

const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 140);
const rig = new CameraRig(camera, ui.stage);

// 支点（扉足元）周りは明るい白、外側へごく薄いトーンの放射グラデーション
const floorTex = (() => {
  const size = 512;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.22, '#ffffff');
  g.addColorStop(0.5, '#fefefe');
  g.addColorStop(0.78, '#fafafa');
  g.addColorStop(1, '#f7f7f8');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
})();

const floorTone = new THREE.Mesh(
  new THREE.CircleGeometry(90, 72),
  new THREE.MeshBasicMaterial({
    map: floorTex,
    color: 0xffffff,
    fog: true,
  }),
);
floorTone.rotation.x = -Math.PI / 2;
floorTone.receiveShadow = true;
scene.add(floorTone);

const floorShadow = new THREE.Mesh(
  new THREE.CircleGeometry(90, 72),
  new THREE.ShadowMaterial({ opacity: 0.12 }),
);
floorShadow.rotation.x = -Math.PI / 2;
floorShadow.receiveShadow = true;
floorShadow.position.y = 0.002;
scene.add(floorShadow);

// 遠景の白いドーム（境界を消して奥行きを伸ばす）
const skyDome = new THREE.Mesh(
  new THREE.SphereGeometry(95, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.52),
  new THREE.MeshBasicMaterial({ color: SPACE, side: THREE.BackSide, fog: true }),
);
skyDome.position.y = -0.5;
scene.add(skyDome);

// 3方向の扉に光が回るよう、環境光を強め＋複数の斜光
const ambient = new THREE.AmbientLight(0xffffff, 0.55);
scene.add(ambient);
const hemi = new THREE.HemisphereLight(0xffffff, 0xf0f0f0, 0.35);
scene.add(hemi);
// 真上すぎると開いた扉の床影が消えるので、やや斜めから落とす
const key = new THREE.DirectionalLight(0xffffff, 0.5);
key.position.set(2.2, 12.5, 5.5);
key.target.position.set(0, 0, 0);
scene.add(key.target);
key.castShadow = !lowPower;
if (key.castShadow) {
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.near = 2;
  key.shadow.camera.far = 36;
  key.shadow.camera.left = -16;
  key.shadow.camera.right = 16;
  key.shadow.camera.top = 16;
  key.shadow.camera.bottom = -16;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.035;
  key.shadow.radius = 18;
  if ('intensity' in key.shadow) key.shadow.intensity = 0.45;
}
scene.add(key);
const fillA = new THREE.DirectionalLight(0xffffff, 0.55);
fillA.position.set(8, 4, -4);
scene.add(fillA);
const fillB = new THREE.DirectionalLight(0xffffff, 0.55);
fillB.position.set(-8, 4, -4);
scene.add(fillB);
const fillC = new THREE.DirectionalLight(0xffffff, 0.45);
fillC.position.set(0, 3.5, 9);
scene.add(fillC);

function setStatus(text, kind = '') {
  ui.status.textContent = text;
  ui.status.dataset.kind = kind;
  ui.status.hidden = !text;
}

function resize() {
  const w = ui.stage.clientWidth;
  const h = ui.stage.clientHeight;
  if (w < 1 || h < 1) return;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
}

function hitProxies() {
  return gates.map((g) => g.hitProxy);
}

function pickGate(ndc) {
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObjects(hitProxies(), false);
  if (!hits.length) return null;
  const id = hits[0].object.userData.gateId;
  return gates.find((g) => g.def.id === id) || null;
}

/** @returns {{ url: string, gateId: string } | null} */
function pickWorkLink(ndc) {
  const meshes = gates.flatMap((g) => g.getWorkLinkMeshes());
  if (!meshes.length) return null;
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObjects(meshes, false);
  if (!hits.length) return null;
  const obj = hits[0].object;
  const url = obj.userData.workUrl;
  if (!url) return null;
  return { url, gateId: obj.userData.gateId || '' };
}

function updateAiming() {
  const pointerIn =
    rig.pointerInside &&
    Math.abs(pointerNdc.x) <= 1 &&
    Math.abs(pointerNdc.y) <= 1;

  let aimGate = null;
  hoverGateId = null;

  if (!coarsePointer && pointerIn) {
    // PC: ポインターが3D領域内ならホバー優先
    const hovered = pickGate(pointerNdc);
    if (hovered) {
      aimGate = hovered;
      hoverGateId = hovered.def.id;
      lastHoverSample = true;
    } else {
      lastHoverSample = false;
      aimGate = pickGate(centerNdc);
    }
  } else {
    lastHoverSample = false;
    aimGate = pickGate(centerNdc);
  }

  // 同時に開く扉は原則1基。競合時は aim 対象以外を外す
  for (const g of gates) {
    const isAim = aimGate && g.def.id === aimGate.def.id;
    g.setAimed(!!isAim);
  }
  return aimGate;
}

function onOpenChange() {
  /* CTA は一旦非表示。扉の開閉のみ */
}

/** iPhone 等: 端末の向きで見回す（iOS はタップ許可が必要） */
async function enableMotionLook(fromUserGesture = true) {
  if (!fromUserGesture) return { ok: false };
  if (rig.sensorEnabled) {
    if (ui.motionPrompt) ui.motionPrompt.hidden = true;
    return { ok: true };
  }
  const result = await rig.enableSensor();
  if (ui.motionPrompt) {
    if (result.ok) {
      ui.motionPrompt.hidden = true;
    } else if (result.reason) {
      ui.motionPrompt.textContent = 'スワイプで見渡せます';
      ui.motionPrompt.hidden = false;
      window.setTimeout(() => {
        if (ui.motionPrompt && !rig.sensorEnabled) ui.motionPrompt.hidden = true;
      }, 3200);
    }
  }
  return result;
}

function setupMotionPrompt() {
  if (!ui.motionPrompt) return;
  const needsMotion =
    coarsePointer ||
    /iPhone|iPad|iPod|Android/i.test(navigator.userAgent || '') ||
    typeof DeviceOrientationEvent !== 'undefined';
  if (!needsMotion) {
    ui.motionPrompt.hidden = true;
    return;
  }
  ui.motionPrompt.hidden = false;
  ui.motionPrompt.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    enableMotionLook(true);
  });
}

rig.onTap = (e) => {
  // モバイル初回タップでセンサー許可を取る（扉操作と両立）
  if (coarsePointer && !rig.sensorEnabled) {
    enableMotionLook(true);
  }

  const rect = ui.stage.getBoundingClientRect();
  const ndc = new THREE.Vector2(
    ((e.clientX - rect.left) / rect.width) * 2 - 1,
    -((e.clientY - rect.top) / rect.height) * 2 + 1,
  );

  // 開いた扉内のサムネ → 作品ページへ
  const link = pickWorkLink(ndc);
  if (link) {
    window.open(link.url, '_blank', 'noopener,noreferrer');
    return;
  }

  const gate = pickGate(ndc);
  if (!gate) return;

  // クリックした扉へ視線を寄せて開く
  rig.focusOn(gate.worldCenter);
  ensureExclusive(gate);
  gate.requestOpen();
};

function ensureExclusive(gate) {
  for (const g of gates) {
    if (g.def.id !== gate.def.id && g.state !== 'closed') g.beginClose();
  }
}

ui.stage.addEventListener('pointermove', (e) => {
  const rect = ui.stage.getBoundingClientRect();
  const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  const ny = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  pointerNdc.set(nx, ny);
  rig.setPointerLook(nx, ny, true);

  const overLink = !coarsePointer && !!pickWorkLink(pointerNdc);
  ui.stage.style.cursor = overLink ? 'pointer' : '';
});
ui.stage.addEventListener('pointerleave', () => {
  rig.setPointerLook(0, 0, false);
  ui.stage.style.cursor = '';
});

let focusIndex = 0;

function focusGateByIndex(index) {
  if (!gates.length) return null;
  focusIndex = ((index % gates.length) + gates.length) % gates.length;
  const gate = gates[focusIndex];
  rig.focusOn(gate.worldCenter);
  return gate;
}

document.addEventListener('keydown', (e) => {
  if (disposed || !gates.length) return;

  if (e.key === 'ArrowLeft') {
    e.preventDefault();
    focusGateByIndex(focusIndex - 1);
  }
  if (e.key === 'ArrowRight') {
    e.preventDefault();
    focusGateByIndex(focusIndex + 1);
  }
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    const aimed = pickGate(centerNdc) || gates[focusIndex];
    if (!aimed) return;
    focusIndex = Math.max(0, gates.indexOf(aimed));
    ensureExclusive(aimed);
    rig.focusOn(aimed.worldCenter);
    aimed.requestOpen();
  }
  if (e.key === 'Escape') {
    gates.forEach((g) => g.beginClose());
  }
});

/**
 * @param {import('./config.js').GateDef} def
 * @param {GLTFLoader} loader
 * @param {number} particleLimit
 */
async function createGateFromDef(def, loader, particleLimit) {
  const gltf = await loader.loadAsync(def.modelUrl);
  const root = gltf.scene;
  root.updateMatrixWorld(true);

  let clip = (gltf.animations || []).find((a) => a.name === 'Open_4_seconds');
  if (!clip && gltf.animations && gltf.animations.length) clip = gltf.animations[0];
  if (!clip) throw new Error('Open_4_seconds アニメーションが見つかりません');

  const gate = new GateInstance({
    def,
    root,
    clip,
    reducedMotion,
    particleLimit,
    onOpenChange,
  });
  scene.add(gate.group);
  return gate;
}

/** @param {GateInstance} gate */
function applyStartView(gate, index) {
  rig.position.set(0, 1.52, 0);
  rig.anchor.copy(gate.worldCenter);
  rig.target.copy(rig.anchor);
  rig.distance = VIEW_RADIUS;
  rig.baseYaw = gate.def.viewAngle || 0;
  rig.basePitch = 0;
  focusIndex = index;
  rig.apply();
}

async function loadGates() {
  const defs = getActiveGates();
  if (!defs.length) {
    setStatus('表示する扉がありません。', 'error');
    return false;
  }

  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const particleLimit = lowPower ? QUALITY.lowParticleCount : QUALITY.particleCount;

  // 正面にする扉を先に読み、残りは裏で並列
  const startIndex = Math.floor(Math.random() * defs.length);

  setStatus('モデルを読み込み中…', 'loading');

  try {
    const first = await createGateFromDef(defs[startIndex], loader, particleLimit);
    gates = [first];
    applyStartView(first, 0);
    setStatus('');

    const loaded = await Promise.all(
      defs.map((def, i) =>
        i === startIndex ? Promise.resolve(first) : createGateFromDef(def, loader, particleLimit),
      ),
    );

    gates = loaded;
    applyStartView(gates[startIndex], startIndex);
    return true;
  } catch (err) {
    console.error(err);
    setStatus('モデルの読み込みに失敗しました。ファイル配置とパスを確認してください。', 'error');
    return false;
  }
}

function tick() {
  if (disposed) return;
  raf = requestAnimationFrame(tick);
  const dt = Math.min(0.05, clock.getDelta());

  const aimGate = updateAiming();
  void aimGate;

  // 同時に開く扉は原則1基。すでに開いている／開き中があればそれ以外は自動開始しない
  const active = gates.find((g) => g.state === 'opening' || g.state === 'open');

  for (const g of gates) {
    const exclusiveOk = !active || active === g;
    g.update(dt, { allowAuto: !reducedMotion, exclusiveOk });
  }

  rig.update(dt);
  renderer.render(scene, camera);
}

function disposeAll() {
  if (disposed) return;
  disposed = true;
  cancelAnimationFrame(raf);
  rig.dispose();
  gates.forEach((g) => g.dispose());
  gates = [];
  renderer.dispose();
  if (renderer.domElement.parentNode) {
    renderer.domElement.parentNode.removeChild(renderer.domElement);
  }
  window.removeEventListener('resize', resize);
  document.removeEventListener('visibilitychange', onVis);
}

function onVis() {
  if (document.hidden) clock.getDelta();
}

window.addEventListener('resize', resize);
window.addEventListener('pagehide', disposeAll);
window.addEventListener('beforeunload', disposeAll);
document.addEventListener('visibilitychange', onVis);

resize();
setupMotionPrompt();
loadGates().then((ok) => {
  if (ok && !disposed) tick();
});

// デバッグ用（コンソールから TIMING 調整を確認可能）
window.__blackGate = { TIMING, QUALITY, getGates: () => gates, rig };
