import * as THREE from 'three';
import { TIMING, QUALITY } from './config.js';
import { GateInterior } from './GateInterior.js';

/** @typedef {'closed'|'aiming'|'opening'|'open'|'closing'} GateState */

let sharedCircleTexture = null;
let sharedWhiteCircleTexture = null;
let sharedContactShadowTexture = null;

function getCircleTexture(theme = 'black') {
  if (theme === 'white') {
    if (sharedWhiteCircleTexture) return sharedWhiteCircleTexture;
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.7, 'rgba(255,255,255,0.28)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    sharedWhiteCircleTexture = new THREE.CanvasTexture(canvas);
    sharedWhiteCircleTexture.colorSpace = THREE.SRGBColorSpace;
    return sharedWhiteCircleTexture;
  }
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

/** 扉足元の接地影（楕円・縁ぼかし）。開き後も消えないよう常設 */
function getContactShadowTexture() {
  if (sharedContactShadowTexture) return sharedContactShadowTexture;
  const w = 256;
  const h = 128;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w * 0.48);
  g.addColorStop(0, 'rgba(0,0,0,0.55)');
  g.addColorStop(0.35, 'rgba(0,0,0,0.32)');
  g.addColorStop(0.65, 'rgba(0,0,0,0.12)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  sharedContactShadowTexture = new THREE.CanvasTexture(canvas);
  sharedContactShadowTexture.colorSpace = THREE.SRGBColorSpace;
  return sharedContactShadowTexture;
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
    this.theme = def.theme === 'white' ? 'white' : 'black';
    this.opening = def.opening === 'inward' ? 'inward' : 'outward';
    this.isWhite = this.theme === 'white';

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
    this.frame = root.getObjectByName('Frame');
    // 黒い扉: 手前（+Z）へ最大72° / 白い扉: フレーム沿いの奥（-Z）へ最大85°
    this.maxOpenRad = THREE.MathUtils.degToRad(this.opening === 'inward' ? 85 : 72);

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
        if (this.isWhite) {
          // 白い彫刻石を保持。影が乗るようラフネスだけ少し落とす
          if (!mat.color || mat.color.getHex() < 0x808080) {
            mat.color = new THREE.Color(0xf4f2ec);
          }
          if ('metalness' in mat) mat.metalness = Math.min(mat.metalness ?? 0.05, 0.12);
          if ('roughness' in mat) mat.roughness = Math.max(mat.roughness ?? 0.55, 0.42);
          if ('envMapIntensity' in mat) mat.envMapIntensity = 0.55;
          deepenReliefNormals(mat, 1.35);
        } else {
          mat.color = new THREE.Color(0x050506);
          mat.metalness = 0.62;
          mat.roughness = 0.38;
          mat.envMapIntensity = 0.35;
          deepenReliefNormals(mat, 2.5);
        }
        obj.material = mat;
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
    });

    // 扉開口に合わせた光面（黒=闇、白=奥からの白い光）
    const doorW = this.isWhite ? 2.12 : 1.68;
    const doorH = this.isWhite ? 5.2 : 3.13;
    const doorCy = this.isWhite ? 2.72 : 1.565;
    this.voidGroup = new THREE.Group();
    this.voidGroup.visible = true;
    this.voidUniforms = { uOpacity: { value: 0 } };

    this.voidMat = new THREE.ShaderMaterial({
      uniforms: this.voidUniforms,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      toneMapped: false,
      blending: this.isWhite ? THREE.AdditiveBlending : THREE.NormalBlending,
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: this.isWhite
        ? `
        uniform float uOpacity;
        varying vec2 vUv;
        void main() {
          vec2 p = abs(vUv - 0.5) * 2.0;
          float box = max(p.x, p.y);
          // 中心が一番明るく、縁へ向かってやわらかく落ちる
          float radial = 1.0 - smoothstep(0.05, 1.12, length(vUv - 0.5) * 2.0);
          float fill = 1.0 - smoothstep(0.42, 1.0, box);
          float soft = radial * radial * fill;
          vec3 col = mix(vec3(0.86, 0.88, 0.94), vec3(1.0, 1.0, 1.0), radial);
          float alpha = uOpacity * soft * 0.55;
          if (alpha < 0.008) discard;
          gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.72));
        }
      `
        : `
        uniform float uOpacity;
        varying vec2 vUv;
        void main() {
          vec2 p = abs(vUv - 0.5) * 2.0;
          float box = max(p.x, p.y);
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
    // 白い扉は枠平面基準(Z≈0.145)の少し奥側から光が溢れる
    this.voidMesh.position.set(0, doorCy, this.isWhite ? -0.05 : -0.12);
    this.voidMesh.renderOrder = -1;
    this.voidGroup.add(this.voidMesh);

    this.voidUniformsDeep = { uOpacity: { value: 0 } };
    const deepMat = this.voidMat.clone();
    deepMat.uniforms = this.voidUniformsDeep;
    this.voidMeshDeep = new THREE.Mesh(
      new THREE.PlaneGeometry(doorW * (this.isWhite ? 1.08 : 1), doorH * (this.isWhite ? 1.04 : 1)),
      deepMat,
    );
    this.voidMeshDeep.position.set(0, doorCy, this.isWhite ? -1.6 : -2.2);
    this.voidMeshDeep.renderOrder = -2;
    this.voidGroup.add(this.voidMeshDeep);

    if (this.isWhite) {
      // 奥の薄い補助面（飽和させず、奥行きのグラデだけ足す）
      this.voidUniformsBloom = { uOpacity: { value: 0 } };
      const bloomMat = this.voidMat.clone();
      bloomMat.uniforms = this.voidUniformsBloom;
      this.voidMeshBloom = new THREE.Mesh(new THREE.PlaneGeometry(doorW * 1.2, doorH * 1.1), bloomMat);
      this.voidMeshBloom.position.set(0, doorCy, -0.7);
      this.voidMeshBloom.renderOrder = -3;
      this.voidGroup.add(this.voidMeshBloom);
    } else {
      this.voidUniformsBloom = null;
      this.voidMeshBloom = null;
    }

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
    this.ambientEmitPerSec = this.isWhite
      ? Math.round((QUALITY.ambientEmitPerSec ?? 24) * 0.55)
      : (QUALITY.ambientEmitPerSec ?? 24);
    this.openingEmitPerSec = this.isWhite
      ? Math.round((QUALITY.openingEmitPerSec ?? 110) * 0.45)
      : (QUALITY.openingEmitPerSec ?? 110);

    const hit = new THREE.Mesh(
      new THREE.BoxGeometry(this.isWhite ? 2.6 : 1.72, this.isWhite ? 5.5 : 3.2, this.isWhite ? 0.45 : 0.28),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    hit.position.set(0, this.isWhite ? 2.85 : 1.62, 0.02);
    hit.name = `HitProxy_${def.id}`;
    hit.userData.gateId = def.id;
    hit.userData.isGateHit = true;
    this.hitProxy = hit;
    this.group.add(hit);

    // 足元のソフト接地影（ディレクショナル影は開扉で薄れるため常設で補う）
    this.contactShadowMat = new THREE.MeshBasicMaterial({
      map: getContactShadowTexture(),
      transparent: true,
      opacity: this.isWhite ? 0.42 : 0.55,
      depthWrite: false,
      fog: true,
      toneMapped: false,
    });
    this.contactShadow = new THREE.Mesh(
      new THREE.PlaneGeometry(this.isWhite ? 4.4 : 2.35, this.isWhite ? 1.7 : 1.05),
      this.contactShadowMat,
    );
    this.contactShadow.rotation.x = -Math.PI / 2;
    this.contactShadow.position.set(0, 0.012, this.isWhite ? 0.05 : 0.12);
    this.contactShadow.renderOrder = 1;
    this.contactShadow.receiveShadow = false;
    this.contactShadow.castShadow = false;
    this.group.add(this.contactShadow);
    this._contactShadowBase = {
      w: this.isWhite ? 4.4 : 2.35,
      d: this.isWhite ? 1.7 : 1.05,
      z: this.isWhite ? 0.05 : 0.12,
      opacity: this.isWhite ? 0.42 : 0.55,
    };

    this.interior = new GateInterior({
      def,
      parent: this.group,
      reducedMotion,
    });

    this.applyPose();
    this.updateVoid();
    this.updateContactShadow();
  }

  createCircularParticles(count) {
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const alphas = new Float32Array(count);
    const data = [];
    const theme = this.theme;

    for (let i = 0; i < count; i += 1) {
      positions[i * 3] = 0;
      positions[i * 3 + 1] = this.isWhite ? 2.6 : 1.4;
      positions[i * 3 + 2] = 0.05;
      sizes[i] = 0;
      alphas[i] = 0;
      data.push(makeParticleSeed(i, { theme }));
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: getCircleTexture(theme) },
        uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) },
        uBaseSize: { value: this.isWhite ? 42.0 : 58.0 },
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
          gl_PointSize = clamp(uBaseSize * aSize * uPixelRatio * atten, 4.0, 140.0);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: this.isWhite
        ? `
        uniform sampler2D uMap;
        varying float vAlpha;
        void main() {
          vec4 tex = texture2D(uMap, gl_PointCoord);
          float alpha = tex.a * vAlpha;
          if (alpha < 0.02) discard;
          gl_FragColor = vec4(1.0, 1.0, 1.0, alpha);
        }
      `
        : `
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
      blending: this.isWhite ? THREE.AdditiveBlending : THREE.NormalBlending,
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
    const v = new THREE.Vector3(0, this.isWhite ? 2.75 : 1.55, 0);
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

    // 開き始めに中央から一気に湧く第一波（残りは opening 中に追加放出）
    const firstWave = Math.max(48, Math.floor(n * 0.42));
    for (let i = 0; i < data.length; i += 1) {
      if (i >= firstWave) {
        data[i].alive = false;
        sizes[i] = 0;
        alphas[i] = 0;
        continue;
      }
      const seed = makeParticleSeed(i + epoch * 17, { burst: true, theme: this.theme });
      data[i] = seed;
      seed.alive = true;
      seed.fading = false;
      seed.age = seed.delay + (i % 5) * 0.01;
      positions[i * 3] = seed.origin.x;
      positions[i * 3 + 1] = seed.origin.y;
      positions[i * 3 + 2] = seed.origin.z;
      sizes[i] = seed.size * 0.6;
      alphas[i] = seed.peakAlpha * 0.75;
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

  /**
   * 空きスロットへ粒子を放出する。
   * @param {number} dt
   * @param {number} rate 個/秒
   * @param {{ burst?: boolean, ambient?: boolean, sizeMul?: number, alphaMul?: number }} kind
   */
  emitParticles(dt, rate, kind = {}) {
    if (this.reducedMotion || rate <= 0) return;
    this._emitAcc += dt;
    const interval = 1 / rate;
    const { data, positions, sizes, alphas } = this.particles;
    const sizeMul = kind.sizeMul ?? (kind.ambient ? 0.45 : 0.6);
    const alphaMul = kind.alphaMul ?? (kind.ambient ? 0.5 : 0.72);
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
        burst: !!kind.burst,
        ambient: !!kind.ambient,
        theme: this.theme,
      });
      data[slot] = seed;
      seed.alive = true;
      seed.fading = false;
      seed.age = seed.delay;
      positions[slot * 3] = seed.origin.x;
      positions[slot * 3 + 1] = seed.origin.y;
      positions[slot * 3 + 2] = seed.origin.z;
      sizes[slot] = seed.size * sizeMul;
      alphas[slot] = seed.peakAlpha * alphaMul;
    }
  }

  /** 開扉中：合わせ目から多めに湧き出す */
  emitOpening(dt) {
    const p = this.openProgress;
    // 開き始め〜半ばで特に多く、終わりに向けて少し落とす
    const boost = 0.65 + Math.sin(Math.min(1, p) * Math.PI) * 0.85;
    this.emitParticles(dt, this.openingEmitPerSec * boost, {
      burst: true,
      sizeMul: 0.65,
      alphaMul: 0.78,
    });
  }

  /** 開状態で薄い黒い光を出し続ける */
  emitAmbient(dt) {
    this.emitParticles(dt, this.ambientEmitPerSec, { ambient: true });
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
    this.updateContactShadow();
    this.updateParticles(dt);
    this.interior?.update(this.openProgress, dt);
  }

  /** 扉内サムネのクリック判定用メッシュ */
  getWorkLinkMeshes() {
    return this.interior?.getClickableMeshes() || [];
  }

  applyPose() {
    const u = this.openProgress;
    const eased = u * u * (3 - 2 * u);
    const ang = eased * this.maxOpenRad;
    // Frame / Frame_Cap_* は固定。扉板だけ回転する
    if (this.opening === 'inward') {
      // 奥（-Z）への観音開き：左 +Y、右 -Y（モデル仕様どおり）
      if (this.doorLeft) {
        this.doorLeft.rotation.set(0, ang, 0);
        this.doorLeft.quaternion.setFromEuler(this.doorLeft.rotation);
      }
      if (this.doorRight) {
        this.doorRight.rotation.set(0, -ang, 0);
        this.doorRight.quaternion.setFromEuler(this.doorRight.rotation);
      }
    } else {
      // 手前（+Z）への観音開き：左 -Y、右 +Y
      if (this.doorLeft) {
        this.doorLeft.rotation.set(0, -ang, 0);
        this.doorLeft.quaternion.setFromEuler(this.doorLeft.rotation);
      }
      if (this.doorRight) {
        this.doorRight.rotation.set(0, ang, 0);
        this.doorRight.quaternion.setFromEuler(this.doorRight.rotation);
      }
    }
  }

  updateVoid() {
    const p = this.openProgress;
    if (this.isWhite) {
      // 開きに合わせてゆっくり立ち上がり、全体を抑えめのグラデーションに
      const reveal = p <= 0 ? 0 : THREE.MathUtils.smoothstep(p, 0.08, 0.95);
      this.voidUniforms.uOpacity.value = reveal * 0.42;
      this.voidUniformsDeep.uOpacity.value = reveal * 0.28;
      if (this.voidUniformsBloom) this.voidUniformsBloom.uOpacity.value = reveal * 0.16;
    } else {
      const reveal = p <= 0 ? 0 : THREE.MathUtils.clamp(0.9 + p * 0.1, 0, 1);
      this.voidUniforms.uOpacity.value = reveal;
      this.voidUniformsDeep.uOpacity.value = reveal * 0.95;
    }
    this.voidGroup.visible = true;
  }

  updateContactShadow() {
    if (!this.contactShadow || !this.contactShadowMat) return;
    const p = this.openProgress;
    const eased = p * p * (3 - 2 * p);
    const base = this._contactShadowBase;
    // 開いても消さず、少し手前へ広がりつつ薄くする
    // 奥開きの白い扉は翼が手前を通るので、影も手前側へ少し伸ばす
    const scaleX = 1 + eased * (this.isWhite ? 0.4 : 0.28);
    const scaleZ = 1 + eased * (this.isWhite ? 0.7 : 0.55);
    this.contactShadow.scale.set(scaleX, scaleZ, 1);
    this.contactShadow.position.z = base.z + eased * (this.isWhite ? 0.55 : 0.38);
    this.contactShadowMat.opacity = base.opacity * (1 - eased * 0.22);
  }

  updateParticles(dt) {
    if (this.state === 'opening') {
      this.particles.active = true;
      this.particles.points.visible = true;
      this.emitOpening(dt);
    } else if (this.state === 'open') {
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
    this.voidMeshBloom?.geometry.dispose();
    this.voidMeshBloom?.material.dispose();
    this.contactShadow?.geometry.dispose();
    this.contactShadowMat?.dispose();
    this.group.traverse((obj) => {
      if (
        obj === this.particles.points ||
        obj === this.voidMesh ||
        obj === this.voidMeshDeep ||
        obj === this.voidMeshBloom ||
        obj === this.contactShadow
      ) {
        return;
      }
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
 * @param {{ burst?: boolean, ambient?: boolean, theme?: string }} [opts]
 */
function makeParticleSeed(i, opts = {}) {
  const r = (n) => {
    const x = Math.sin(n * 127.1 + i * 311.7) * 43758.5453;
    return x - Math.floor(x);
  };
  const phase = r(1);
  const ambient = !!opts.ambient;
  const burst = !!opts.burst;
  const white = opts.theme === 'white';
  // バースト／常時とも短い遅延で中央から連続的に湧く
  const delay = ambient ? r(2) * 0.06 : burst ? r(2) * 0.1 : 0.04 + r(2) * 0.28;
  // 扉中央の合わせ目（縦の隙間）から拡散。白い扉は開口が高いので縦に広げる
  const ox = (r(3) - 0.5) * (ambient ? 0.1 : 0.14);
  const oy = white
    ? 1.1 + r(4) * (ambient ? 3.2 : 3.6)
    : 0.7 + r(4) * (ambient ? 1.6 : 1.85);
  // 白い光は奥側の開口から手前へ溢れ出す
  const oz = white ? -0.08 + r(5) * 0.12 : 0.01 + r(5) * 0.08;
  const scale = ambient ? 0.6 : 1;
  const zDrift = white
    ? (1.2 + r(8) * 3.2) * scale
    : (0.7 + r(8) * 2.5) * scale;
  return {
    origin: new THREE.Vector3(ox, oy, oz),
    drift: new THREE.Vector3(
      (r(6) - 0.5) * (white ? 3.4 : 2.8) * scale,
      (0.35 + r(7) * (white ? 2.8 : 2.3)) * scale,
      zDrift,
    ),
    size: (0.4 + r(9) * 1.05) * (ambient ? 0.8 : 1) * (white ? 0.75 : 1),
    peakAlpha: (0.5 + r(10) * 0.45) * (ambient ? 0.6 : 1) * (white ? 0.38 : 1),
    delay,
    riseDur: ambient ? 1.5 + r(11) * 1.4 : 2.0 + r(11) * 2.0,
    fadeStart: ambient ? 0.65 + r(12) * 1.0 : 0.9 + r(12) * 1.6,
    fadeDur: ambient ? 0.75 + r(13) * 0.8 : 1.0 + r(13) * 1.2,
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

