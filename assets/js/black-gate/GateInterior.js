import * as THREE from 'three';
import { TIMING } from './config.js';

/**
 * 開いた扉の奥に、学生名・作品サムネをぼわっと・ゆらゆら映す。
 * 扉が開ききってから、中心→外側へ広がるように出現する。
 */
export class GateInterior {
  /**
   * @param {object} opts
   * @param {import('./config.js').GateDef} opts.def
   * @param {THREE.Group} opts.parent
   * @param {boolean} opts.reducedMotion
   */
  constructor({ def, parent, reducedMotion }) {
    this.def = def;
    this.reducedMotion = reducedMotion;
    this.group = new THREE.Group();
    this.group.name = `Interior_${def.id}`;
    this.group.position.set(0, 1.55, -0.08);
    this.group.visible = false;
    this.time = 0;
    /** 開ききり後の出現経過（秒） */
    this.revealAge = 0;
    this.fullyOpen = false;
    this.ready = false;
    /** @type {Array<object>} */
    this.parts = [];
    /** @type {THREE.Mesh[]} */
    this.linkMeshes = [];

    parent.add(this.group);

    if (!def.studentName && !def.cohortLabel) return;

    this._build().catch((err) => {
      console.warn('GateInterior build failed', def.id, err);
    });
  }

  async _build() {
    const images = Array.isArray(this.def.imageUrls) ? this.def.imageUrls.filter(Boolean) : [];
    const workUrl = this.def.workUrl || null;

    // 名前行（中心）→ 期生ラベル → 画像（外側）の順で広がる
    const nameY = 0.02;
    const cohortY = 0.38;
    const imageY = 0.92;

    if (this.def.studentName) {
      this._addCharLine(this.def.studentName, {
        y: nameY,
        z: 0.05,
        charHeight: 0.2,
        gap: 0.018,
        type: 'name',
        radialBase: 0.05,
      });
    }

    if (this.def.cohortLabel || this.def.statusLabel) {
      const cohortParts = [this.def.cohortLabel, this.def.statusLabel].filter(Boolean);
      this._addCharLine(cohortParts.join('　'), {
        y: cohortY,
        z: 0.04,
        charHeight: 0.088,
        gap: 0.01,
        type: 'cohort',
        radialBase: 0.22,
      });
    }

    if (images[0]) {
      const tex = await loadSoftImageTexture(images[0]);
      if (tex) {
        this.parts.push(
          this._makeImagePlane(tex, {
            width: 1.08,
            y: imageY,
            z: 0.02,
            sway: 0.9,
            phase: 0.4,
            workUrl,
            radial: Math.abs(imageY) + 0.15,
          }),
        );
      }
    }

    this.ready = this.parts.length > 0;
  }

  /**
   * 1行を文字ごとのメッシュに分割して配置
   */
  _addCharLine(text, { y, z, charHeight, gap, type, radialBase }) {
    const chars = Array.from(text);
    if (!chars.length) return;

    const metrics = chars.map((ch) => {
      const isSpace = ch === ' ' || ch === '　';
      const tex = isSpace ? null : makeGlowCharTexture(ch, type === 'name' ? 1 : 0.85);
      const aspect = tex ? tex.image.width / tex.image.height : 0.45;
      const h = charHeight;
      const w = isSpace ? charHeight * 0.35 : h * aspect * 0.92;
      return { ch, tex, w, h, isSpace };
    });

    const totalW =
      metrics.reduce((s, m) => s + m.w, 0) + Math.max(0, metrics.length - 1) * gap;
    let x = -totalW / 2;

    metrics.forEach((m, i) => {
      const cx = x + m.w / 2;
      x += m.w + gap;
      if (m.isSpace || !m.tex) return;

      const mat = new THREE.MeshBasicMaterial({
        map: m.tex,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        depthTest: true,
        toneMapped: false,
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(m.w, m.h), mat);
      mesh.position.set(cx, y, z);
      mesh.scale.setScalar(0.35);
      mesh.renderOrder = 3;
      mesh.userData.isWorkLink = false;
      this.group.add(mesh);

      const radial = radialBase + Math.abs(cx) * 0.55 + Math.abs(y) * 0.15;
      this.parts.push({
        mesh,
        mat,
        baseX: cx,
        baseY: y,
        sway: 0.85 + (i % 5) * 0.08,
        phase: i * 0.73 + (type === 'name' ? 0.2 : 1.4),
        type,
        radial,
        reveal: 0,
      });
    });
  }

  _makeImagePlane(texture, { width, y, z, sway, phase, workUrl, radial }) {
    const img = texture.image;
    const aspect = img && img.width && img.height ? img.width / img.height : 16 / 9;
    const w = width;
    const h = Math.min(0.58, w / aspect);
    const mat = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      depthTest: true,
      toneMapped: false,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    mesh.position.set(0, y, z);
    mesh.scale.setScalar(0.35);
    mesh.renderOrder = 2;
    mesh.userData.isWorkLink = !!workUrl;
    mesh.userData.workUrl = workUrl || null;
    mesh.userData.gateId = this.def.id;
    this.group.add(mesh);
    if (workUrl) this.linkMeshes.push(mesh);
    return {
      mesh,
      mat,
      baseY: y,
      baseX: 0,
      sway,
      phase,
      type: 'image',
      radial,
      reveal: 0,
    };
  }

  getClickableMeshes() {
    if (!this.ready || !this.group.visible || this.revealAge < 0.6) return [];
    return this.linkMeshes;
  }

  /**
   * @param {number} openProgress 0..1
   * @param {number} dt
   */
  update(openProgress, dt) {
    if (!this.ready) return;
    this.time += dt;

    const openEnough = openProgress >= 0.995;
    if (openEnough) {
      this.fullyOpen = true;
      this.revealAge += dt;
    } else {
      this.fullyOpen = false;
      // 閉じ始めたらすぐ消す
      this.revealAge = Math.max(0, this.revealAge - dt * 3.5);
      if (openProgress < 0.9) this.revealAge = 0;
    }

    const delay = TIMING.interiorRevealDelay ?? 0.12;
    const waveT = Math.max(0, this.revealAge - delay);
    const show = waveT > 0.001 || this.parts.some((p) => p.reveal > 0.02);
    this.group.visible = show;
    if (!show && waveT <= 0) {
      for (const p of this.parts) {
        p.reveal = 0;
        p.mat.opacity = 0;
        p.mesh.scale.setScalar(0.35);
      }
      return;
    }

    // 中心から外側へ：radial が大きいほど遅れて出現
    const spreadSpeed = this.reducedMotion ? 2.4 : 1.35;
    const bloomDur = this.reducedMotion ? 0.35 : 0.7;

    for (const p of this.parts) {
      const localStart = p.radial * 0.55;
      const target = THREE.MathUtils.smoothstep(waveT, localStart, localStart + bloomDur);
      const lerp = target >= p.reveal ? Math.min(1, dt * spreadSpeed) : Math.min(1, dt * 4);
      p.reveal += (target - p.reveal) * lerp;

      const amp = this.reducedMotion ? 0.1 : 1;
      const t = this.time * (0.55 + p.sway * 0.14) + p.phase;
      // 文字ごとに独立したゆらぎ
      const dx = Math.sin(t * 0.9) * 0.012 * amp * p.sway;
      const dy = Math.sin(t * 1.15 + 0.5) * 0.016 * amp * p.sway;
      const rz = Math.sin(t * 0.7 + 0.2) * 0.035 * amp;
      p.mesh.position.x = p.baseX + dx;
      p.mesh.position.y = p.baseY + dy;
      p.mesh.rotation.z = rz;

      // ボワッ：小さめから広がる
      const sc = THREE.MathUtils.lerp(0.32, 1, THREE.MathUtils.smoothstep(p.reveal, 0, 1));
      p.mesh.scale.setScalar(sc);

      let o = p.reveal;
      if (p.type === 'name' || p.type === 'cohort') {
        o *= 0.68 + 0.32 * (0.5 + 0.5 * Math.sin(t * 1.25 + p.phase));
      } else {
        o *= 0.8 + 0.15 * (0.5 + 0.5 * Math.sin(t * 0.8 + 1.0));
      }
      p.mat.opacity = THREE.MathUtils.clamp(o, 0, 1);
    }
  }

  dispose() {
    for (const p of this.parts) {
      p.mesh.geometry.dispose();
      if (p.mat.map) p.mat.map.dispose();
      p.mat.dispose();
    }
    this.parts = [];
    this.linkMeshes = [];
  }
}

/**
 * @param {string} url
 * @returns {Promise<THREE.CanvasTexture|null>}
 */
function loadSoftImageTexture(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const maxW = 960;
        const scale = Math.min(1, maxW / img.width);
        const w = Math.max(2, Math.round(img.width * scale));
        const h = Math.max(2, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);

        const data = ctx.getImageData(0, 0, w, h);
        const px = data.data;
        const fadeX = Math.max(1, w * 0.08);
        const fadeY = Math.max(1, h * 0.1);
        for (let y = 0; y < h; y += 1) {
          for (let x = 0; x < w; x += 1) {
            const i = (y * w + x) * 4;
            const ex = Math.min(x, w - 1 - x) / fadeX;
            const ey = Math.min(y, h - 1 - y) / fadeY;
            const edge = Math.min(1, Math.min(ex, ey));
            const soft = edge * edge * (3 - 2 * edge);
            px[i + 3] = Math.round(255 * soft);
          }
        }
        ctx.putImageData(data, 0, 0);

        const tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.needsUpdate = true;
        resolve(tex);
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/** 1文字分のぼわっとした白文字テクスチャ */
function makeGlowCharTexture(ch, baseAlpha = 1) {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, size, size);

  const fontSize = 150;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `500 ${fontSize}px "Hiragino Mincho ProN", "Yu Mincho", "Noto Serif JP", "PingFang SC", "Hiragino Sans", sans-serif`;

  for (let i = 0; i < 6; i += 1) {
    const ox = (Math.random() - 0.5) * fontSize * 0.06;
    const oy = (Math.random() - 0.5) * fontSize * 0.05;
    ctx.fillStyle = `rgba(255,255,255,${baseAlpha * (0.05 + Math.random() * 0.1)})`;
    ctx.fillText(ch, size / 2 + ox, size / 2 + oy);
  }
  for (let i = 0; i < 4; i += 1) {
    const ox = (Math.random() - 0.5) * 2.4;
    const oy = (Math.random() - 0.5) * 2;
    ctx.fillStyle = `rgba(255,255,255,${baseAlpha * (0.3 + Math.random() * 0.6)})`;
    ctx.fillText(ch, size / 2 + ox, size / 2 + oy);
  }

  // 文字周囲だけ残すようクロップ幅を測る
  const metrics = ctx.measureText(ch);
  const advance = Math.max(metrics.width, fontSize * 0.55);
  const pad = fontSize * 0.35;
  const cropW = Math.min(size, Math.ceil(advance + pad * 2));
  const cropH = Math.min(size, Math.ceil(fontSize + pad * 2));
  const sx = Math.floor((size - cropW) / 2);
  const sy = Math.floor((size - cropH) / 2);

  const cropped = document.createElement('canvas');
  cropped.width = cropW;
  cropped.height = cropH;
  const cctx = cropped.getContext('2d');
  cctx.globalAlpha = 0.22;
  cctx.drawImage(canvas, sx, sy - 1, cropW, cropH, 0, 0, cropW, cropH);
  cctx.drawImage(canvas, sx, sy + 1, cropW, cropH, 0, 0, cropW, cropH);
  cctx.globalAlpha = 1;
  cctx.drawImage(canvas, sx, sy, cropW, cropH, 0, 0, cropW, cropH);

  const tex = new THREE.CanvasTexture(cropped);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}
