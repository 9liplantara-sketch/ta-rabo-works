import * as THREE from 'three';
import { TIMING, QUALITY } from './config.js';
import { GateInterior } from './GateInterior.js';

/** @typedef {'closed'|'aiming'|'opening'|'open'|'closing'} GateState */

let sharedCircleTexture = null;

function getCircleTexture() {
  if (sharedCircleTexture) return sharedCircleTexture;
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(12,12,14,1)');
  g.addColorStop(0.45, 'rgba(12,12,14,0.85)');
  g.addColorStop(0.75, 'rgba(12,12,14,0.25)');
  g.addColorStop(1, 'rgba(12,12,14,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  sharedCircleTexture = new THREE.CanvasTexture(canvas);
  sharedCircleTexture.colorSpace = THREE.SRGBColorSpace;
  return sharedCircleTexture;
}

/**
 * 1基の扉。状態機械・扉アニメ／円形粒子・固定ヒット領域を担当。
 * 学生差し替えは def（modelUrl / workUrl / label）で行う。
 */
export class GateInstance {
  /**
   * @param {object} opts
   * @param {import('./config.js').GateDef} opts.def
   * @param {THREE.Group} opts.root 読み込み済みのシーンルート（ドア＋粒子）
   * @param {THREE.AnimationClip} opts.clip Open_4_seconds
   * @param {boolean} opts.reducedMotion
   * @param {number} opts.particleLimit
   * @param {(gate: GateInstance, openEnough: boolean) => void} [opts.onOpenChange]
   */
  constructor({ def, root, clip, reducedMotion, particleLimit, onOpenChange }) {
    this.def = def;
    this.root = root;
    this.reducedMotion = reducedMotion;
    this.onOpenChange = onOpenChange || (() => {});

    this.state = /** @type {GateState} */ ('closed');
    this.openProgress = 0;
    this.aimTimer = 0;
    this.leaveTimer = 0;
    this.aimed = false;

    this.group = new THREE.Group();
    this.group.name = `Gate_${def.id}`;
    this.group.position.fromArray(def.position);
    this.group.rotation.y = def.yaw || 0;
    this.group.add(root);

    void clip; // 粒子はWeb制御。扉角度も視認性のためWeb制御
    this.doorLeft = root.getObjectByName('Door_Left');
    this.doorRight = root.getObjectByName('Door_Right');
    // 手前（+Z）への観音開き
    this.maxOpenRad = THREE.MathUtils.degToRad(72);

    // GLBの多面体粒子は非表示。Web側の細い円形粒子に置き換える
    root.traverse((obj) => {
      if (!obj.isMesh) return;
      if (obj.name && obj.name.startsWith('Particle_')) {
        obj.visible = false;
        obj.scale.setScalar(0);
        return;
      }
      if (obj.material) {
        const mat = obj.material.clone();
        // レリーフの陰影を深く（ラキング光が乗りやすい材質へ）
        mat.color = new THREE.Color(0x050506);
        mat.metalness = 0.62;
        mat.roughness = 0.38;
        mat.envMapIntensity = 0.35;
        deepenReliefNormals(mat, 2.5);
        obj.material = mat;
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
    });

    // 扉と同形・同面積の四角い黒い穴（楕円に縮めない）
    const doorW = 1.68;
    const doorH = 3.13;
    this.voidGroup = new THREE.Group();
    this.voidGroup.visible = true;
    this.voidUniforms = { uOpacity: { value: 0 } };

    // 扉いっぱいの黒面＋縁だけ滑らかに白へ溶ける（円形マスクは使わない）
    this.voidMat = new THREE.ShaderMaterial({
      uniforms: this.voidUniforms,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      toneMapped: false,
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uOpacity;
        varying vec2 vUv;
        void main() {
          vec2 p = abs(vUv - 0.5) * 2.0;
          float box = max(p.x, p.y);
          // 内側はほぼ真っ黒で扉面積を満たし、外縁だけ滑らかにフェード
          float fill = 1.0 - smoothstep(0.93, 1.0, box);
          float edgeSoft = smoothstep(0.7, 0.98, box);
          vec3 col = mix(vec3(0.0), vec3(0.12), edgeSoft * 0.35);
          float alpha = uOpacity * fill * (0.92 - edgeSoft * 0.25);
          if (alpha < 0.01) discard;
          gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.98));
        }
      `,
    });
    this.voidMesh = new THREE.Mesh(new THREE.PlaneGeometry(doorW, doorH), this.voidMat);
    this.voidMesh.position.set(0, 1.565, -0.12);
    this.voidMesh.renderOrder = -1;
    this.voidGroup.add(this.voidMesh);

    // 奥行き用：同じ四角形を少し後ろに（サイズは扉のまま）
    this.voidUniformsDeep = { uOpacity: { value: 0 } };
    const deepMat = this.voidMat.clone();
    deepMat.uniforms = this.voidUniformsDeep;
    this.voidMeshDeep = new THREE.Mesh(new THREE.PlaneGeometry(doorW, doorH), deepMat);
    this.voidMeshDeep.position.set(0, 1.565, -2.2);
    this.voidMeshDeep.renderOrder = -2;
    this.voidGroup.add(this.voidMeshDeep);

    this.voidLayers = [];
    this.voidBlackMat = null;
    this.voidRimMat = null;
    this.voidRim = null;

    this.group.add(this.voidGroup);

    this.particleCount = Math.max(24, particleLimit | 0);
    this.particles = this.createCircularParticles(this.particleCount);
    this.group.add(this.particles.points);
    this.particleEpoch = 0;
    this._emitAcc = 0;
    this.ambientEmitPerSec = QUALITY.ambientEmitPerSec ?? 14;

    const hit = new THREE.Mesh(
      new THREE.BoxGeometry(1.72, 3.2, 0.28),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    hit.position.set(0, 1.62, 0.02);
    hit.name = `HitProxy_${def.id}`;
    hit.userData.gateId = def.id;
    hit.userData.isGateHit = true;
    this.hitProxy = hit;
    this.group.add(hit);

    this.interior = new GateInterior({
      def,
      parent: this.group,
      reducedMotion,
    });

    this.applyPose();
    this.updateVoid();
  }

  createCircularParticles(count) {
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const alphas = new Float32Array(count);
    const data = [];

    for (let i = 0; i < count; i += 1) {
      positions[i * 3] = 0;
      positions[i * 3 + 1] = 1.4;
      positions[i * 3 + 2] = 0.05;
      sizes[i] = 0;
      alphas[i] = 0;
      data.push(makeParticleSeed(i));
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: getCircleTexture() },
        uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) },
        uBaseSize: { value: 22.0 },
      },
      vertexShader: `
        attribute float aSize;
        attribute float aAlpha;
        uniform float uPixelRatio;
        uniform float uBaseSize;
        varying float vAlpha;
        void main() {
          vAlpha = aAlpha;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          float atten = 1.0 / max(0.55, -mvPosition.z);
          gl_PointSize = clamp(uBaseSize * aSize * uPixelRatio * atten, 2.0, 48.0);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        uniform sampler2D uMap;
        varying float vAlpha;
        void main() {
          vec4 tex = texture2D(uMap, gl_PointCoord);
          float alpha = tex.a * vAlpha;
          if (alpha < 0.02) discard;
          gl_FragColor = vec4(0.04, 0.04, 0.05, alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });

    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    points.visible = false;
    points.renderOrder = 2;

    return {
      points,
      geometry,
      material,
      data,
      positions,
      sizes,
      alphas,
      active: false,
    };
  }

  setParticleBudget(limit) {
    this.particleCount = Math.min(limit, this.particles.data.length);
  }

  get worldCenter() {
    const v = new THREE.Vector3(0, 1.55, 0);
    this.group.localToWorld(v);
    return v;
  }

  /** @param {boolean} aimed */
  setAimed(aimed) {
    this.aimed = aimed;
  }

  requestOpen() {
    if (this.state === 'open' || this.state === 'opening') return;
    this.aimTimer = TIMING.aimHold;
    this.leaveTimer = 0;
    this.aimed = true;
    this.beginOpen();
  }

  beginOpen() {
    if (this.state === 'opening' || this.state === 'open') return;
    this.state = 'opening';
    this.leaveTimer = 0;
    this.startParticlePlayback(this.openProgress);
    this.onOpenChange(this, false);
  }

  beginClose() {
    if (this.state === 'closed' || this.state === 'closing') return;
    this.state = 'closing';
    this.aimTimer = 0;
    this.stopParticlesForClose();
    this.onOpenChange(this, false);
  }

  startParticlePlayback(fromProgress) {
    this.particleEpoch += 1;
    const epoch = this.particleEpoch;
    const { data, positions, sizes, alphas, points } = this.particles;
    const n = this.particleCount;
    this._emitAcc = 0;

    for (let i = 0; i < data.length; i += 1) {
      const seed = makeParticleSeed(i + epoch * 17, { burst: true });
      data[i] = seed;
      seed.alive = i < n;
      seed.fading = false;
      // パッと量が出るよう、大半をほぼ同時に出現させる
      seed.age = seed.delay + (i % 7) * 0.012;
      if (!seed.alive) {
        sizes[i] = 0;
        alphas[i] = 0;
        continue;
      }
      positions[i * 3] = seed.origin.x;
      positions[i * 3 + 1] = seed.origin.y;
      positions[i * 3 + 2] = seed.origin.z;
      sizes[i] = seed.size * 0.55;
      alphas[i] = seed.peakAlpha * 0.7;
    }
    void fromProgress;

    this.particles.geometry.attributes.position.needsUpdate = true;
    this.particles.geometry.attributes.aSize.needsUpdate = true;
    this.particles.geometry.attributes.aAlpha.needsUpdate = true;
    this.particles.active = true;
    points.visible = true;
    this.particles.epoch = epoch;
  }

  stopParticlesForClose() {
    this._emitAcc = 0;
    const { data } = this.particles;
    for (const p of data) {
      if (!p.alive) continue;
      p.fading = true;
      p.fadeDur = Math.min(p.fadeDur, 0.65);
    }
  }

  resetParticlesHidden() {
    this.particleEpoch += 1;
    this._emitAcc = 0;
    const { data, sizes, alphas, points } = this.particles;
    for (let i = 0; i < data.length; i += 1) {
      data[i].alive = false;
      sizes[i] = 0;
      alphas[i] = 0;
    }
    this.particles.geometry.attributes.aSize.needsUpdate = true;
    this.particles.geometry.attributes.aAlpha.needsUpdate = true;
    this.particles.active = false;
    points.visible = false;
  }

  /** 開状態で既存スロットを再利用して薄い黒い光を出し続ける（新規確保なし） */
  emitAmbient(dt) {
    if (this.reducedMotion) return;
    const rate = this.ambientEmitPerSec;
    if (rate <= 0) return;
    this._emitAcc += dt;
    const interval = 1 / rate;
    const { data, positions, sizes, alphas } = this.particles;
    while (this._emitAcc >= interval) {
      this._emitAcc -= interval;
      let slot = -1;
      for (let i = 0; i < data.length; i += 1) {
        if (!data[i].alive) {
          slot = i;
          break;
        }
      }
      if (slot < 0) break;
      const seed = makeParticleSeed(slot + this.particleEpoch * 31 + (Math.random() * 1000) | 0, {
        ambient: true,
      });
      data[slot] = seed;
      seed.alive = true;
      seed.fading = false;
      seed.age = seed.delay;
      positions[slot * 3] = seed.origin.x;
      positions[slot * 3 + 1] = seed.origin.y;
      positions[slot * 3 + 2] = seed.origin.z;
      sizes[slot] = seed.size * 0.4;
      alphas[slot] = seed.peakAlpha * 0.45;
    }
  }

  /**
   * @param {number} dt
   * @param {{ allowAuto: boolean, exclusiveOk: boolean }} ctx
   */
  update(dt, ctx) {
    const { allowAuto, exclusiveOk } = ctx;

    if (this.aimed && exclusiveOk) {
      this.leaveTimer = 0;
      if (allowAuto && !this.reducedMotion) {
        if (this.state === 'closed' || this.state === 'aiming' || this.state === 'closing') {
          if (this.state === 'closed') this.state = 'aiming';
          this.aimTimer += dt;
          if (this.aimTimer >= TIMING.aimHold) this.beginOpen();
        }
      } else if (this.reducedMotion && this.state === 'aiming') {
        this.state = 'closed';
        this.aimTimer = 0;
      }
    } else {
      this.aimTimer = 0;
      if (this.state === 'aiming') this.state = 'closed';
      if (this.state === 'opening' || this.state === 'open') {
        this.leaveTimer += dt;
        if (this.leaveTimer >= TIMING.leaveGrace) this.beginClose();
      }
    }

    const holdWhileClosing =
      this.state === 'closing' && this.aimed && exclusiveOk && this.aimTimer > 0 && this.aimTimer < TIMING.aimHold;

    if (this.state === 'opening') {
      const speed = 1 / TIMING.openDuration;
      this.openProgress = Math.min(1, this.openProgress + dt * speed);
      if (this.openProgress >= 1) {
        this.openProgress = 1;
        this.state = 'open';
        this.onOpenChange(this, true);
      }
    } else if (this.state === 'closing' && !holdWhileClosing) {
      const speed = 1 / TIMING.closeDuration;
      this.openProgress = Math.max(0, this.openProgress - dt * speed);
      if (this.openProgress <= 0) {
        this.openProgress = 0;
        this.state = 'closed';
        this.resetParticlesHidden();
        this.onOpenChange(this, false);
      }
    }

    this.applyPose();
    this.updateVoid();
    this.updateParticles(dt);
    this.interior?.update(this.openProgress, dt);
  }

  /** 扉内サムネのクリック判定用メッシュ */
  getWorkLinkMeshes() {
    return this.interior?.getClickableMeshes() || [];
  }

  applyPose() {
    // 手前（+Z）への観音開き：左は-Y、右は+Y
    const u = this.openProgress;
    const eased = u * u * (3 - 2 * u);
    const ang = eased * this.maxOpenRad;
    if (this.doorLeft) {
      this.doorLeft.rotation.set(0, -ang, 0);
      this.doorLeft.quaternion.setFromEuler(this.doorLeft.rotation);
    }
    if (this.doorRight) {
      this.doorRight.rotation.set(0, ang, 0);
      this.doorRight.quaternion.setFromEuler(this.doorRight.rotation);
    }
  }

  updateVoid() {
    const p = this.openProgress;
    // 開き始めからほぼ濃い黒。薄い→濃いの遅延フェードにしない
    const reveal = p <= 0 ? 0 : THREE.MathUtils.clamp(0.9 + p * 0.1, 0, 1);
    this.voidUniforms.uOpacity.value = reveal;
    this.voidUniformsDeep.uOpacity.value = reveal * 0.95;
    this.voidGroup.visible = true;
  }

  updateParticles(dt) {
    if (this.state === 'open') {
      this.particles.active = true;
      this.particles.points.visible = true;
      this.emitAmbient(dt);
    }

    if (!this.particles.active) return;

    const { data, positions, sizes, alphas } = this.particles;
    let anyAlive = false;

    for (let i = 0; i < data.length; i += 1) {
      const p = data[i];
      if (!p.alive) {
        sizes[i] = 0;
        alphas[i] = 0;
        continue;
      }

      p.age += dt;
      const delay = p.delay;
      if (p.age < delay) {
        sizes[i] = 0;
        alphas[i] = 0;
        anyAlive = true;
        continue;
      }

      const life = p.age - delay;
      const u = Math.min(1, life / p.riseDur);
      const ease = u * u * (3 - 2 * u);

      // 中央の隙間から前方・上方へゆっくり拡散
      const x =
        p.origin.x +
        p.drift.x * ease +
        Math.sin(life * p.wobble + p.phase) * 0.03 * ease;
      const y = p.origin.y + p.drift.y * ease + life * 0.08;
      const z = p.origin.z + p.drift.z * ease;

      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;

      let alpha = Math.min(1, life / 0.2) * p.peakAlpha;
      let size = p.size * Math.min(1, 0.45 + ease);

      if (p.fading || life > p.fadeStart) {
        const fadeT = p.fading ? life : life - p.fadeStart;
        const fadeU = Math.min(1, fadeT / p.fadeDur);
        alpha *= 1 - fadeU;
        size *= 1 - fadeU * 0.35;
        if (fadeU >= 1) {
          p.alive = false;
          sizes[i] = 0;
          alphas[i] = 0;
          continue;
        }
      }

      sizes[i] = size;
      alphas[i] = alpha;
      anyAlive = true;
    }

    this.particles.geometry.attributes.position.needsUpdate = true;
    this.particles.geometry.attributes.aSize.needsUpdate = true;
    this.particles.geometry.attributes.aAlpha.needsUpdate = true;

    if (!anyAlive && this.state !== 'opening' && this.state !== 'open') {
      this.particles.active = false;
      this.particles.points.visible = false;
    }
  }

  dispose() {
    this.interior?.dispose();
    this.particles.geometry.dispose();
    this.particles.material.dispose();
    this.voidMesh?.geometry.dispose();
    this.voidMat?.dispose();
    this.voidMeshDeep?.geometry.dispose();
    this.voidMeshDeep?.material.dispose();
    this.group.traverse((obj) => {
      if (obj === this.particles.points || obj === this.voidMesh || obj === this.voidMeshDeep) return;
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
        else obj.material.dispose();
      }
    });
  }
}

/**
 * @param {number} i
 * @param {{ burst?: boolean, ambient?: boolean }} [opts]
 */
function makeParticleSeed(i, opts = {}) {
  const r = (n) => {
    const x = Math.sin(n * 127.1 + i * 311.7) * 43758.5453;
    return x - Math.floor(x);
  };
  const phase = r(1);
  const ambient = !!opts.ambient;
  const burst = !!opts.burst;
  // バーストはほぼ同時、常時放出はごく短い遅延
  const delay = ambient ? r(2) * 0.08 : burst ? r(2) * 0.18 : 0.05 + r(2) * 0.4;
  // 扉中央の合わせ目付近から拡散
  const ox = (r(3) - 0.5) * (ambient ? 0.16 : 0.28);
  const oy = 0.85 + r(4) * (ambient ? 1.4 : 1.7);
  const oz = 0.02 + r(5) * 0.12;
  const scale = ambient ? 0.55 : 1;
  return {
    origin: new THREE.Vector3(ox, oy, oz),
    drift: new THREE.Vector3(
      (r(6) - 0.5) * 2.6 * scale,
      (0.45 + r(7) * 2.1) * scale,
      (0.65 + r(8) * 2.4) * scale,
    ),
    size: (0.32 + r(9) * 0.9) * (ambient ? 0.75 : 1),
    peakAlpha: (0.45 + r(10) * 0.45) * (ambient ? 0.55 : 1),
    delay,
    riseDur: ambient ? 1.6 + r(11) * 1.4 : 2.2 + r(11) * 2.2,
    fadeStart: ambient ? 0.7 + r(12) * 1.0 : 1.0 + r(12) * 1.8,
    fadeDur: ambient ? 0.8 + r(13) * 0.8 : 1.1 + r(13) * 1.3,
    wobble: 1.0 + r(14) * 2.5,
    phase: phase * Math.PI * 2,
    age: 0,
    alive: false,
    fading: false,
  };
}

/** 法線のXYを強調してレリーフの陰影を深く見せる */
function deepenReliefNormals(material, amount = 1.85) {
  const amp = amount;
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <normal_fragment_maps>',
      `#include <normal_fragment_maps>
normal = normalize(vec3(normal.xy * ${amp.toFixed(2)}, normal.z));`,
    );
  };
  material.customProgramCacheKey = () => `black-gate-deep-relief-v2-${amp}`;
}

