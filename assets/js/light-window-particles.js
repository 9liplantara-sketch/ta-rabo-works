/* 光の窳 — 静止層 + ライブ層の光粒 RGB ベン図。静止層は rAF で消さない */
(function () {
  const venn = document.getElementById('venn');
  const staticLayer = document.getElementById('light-grain-static');
  const canvas = document.getElementById('light-grain');
  const holdLayer = document.getElementById('light-grain-hold');
  if (!venn || !staticLayer || !canvas || !holdLayer) return;

  const stage = document.querySelector('.stage') || venn;
  const hero = document.querySelector('.hero-screen') || stage;
  const trackEl = hero;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const staticLayerCtx = staticLayer.getContext('2d', { alpha: true });
  const ctx = canvas.getContext('2d', { alpha: true });
  const holdCtx = holdLayer.getContext('2d', { alpha: true });

  const CHANNELS = [
    { color: '#ff0000', cx: 0.344, cy: 0.365, r: 0.29 },
    { color: '#00ff00', cx: 0.656, cy: 0.365, r: 0.29 },
    { color: '#0000ff', cx: 0.5, cy: 0.635, r: 0.29 },
  ];
  const CH_COLORS = ['#ff0000', '#00ff00', '#0000ff'];
  const TAU = Math.PI * 2;
  const SETTLE_D2 = 20;
  const SETTLE_IN2 = 7;
  const SETTLE_OUT2 = 30;
  const SETTLE_FRAMES_IN = 10;
  const HOLD_FADE_MS = 520;
  const HOLD_PEAK = 0.85;

  const SPRING = 0.046;
  const DAMP = 0.912;
  const GATHER = 0.017;
  const FLOW = 0.0028;
  const STAGE_GATHER = 0.006;
  const MAX_DRIFT = 0.36;
  const GATHER_R = 0.52;
  const STAGE_GATHER_R = 0.58;
  const DWELL_MS = 1000;
  const DWELL_MOVE_PX = 5;

  let particles = [];
  let w = 0;
  let h = 0;
  let dpr = 1;
  let raf = 0;
  let t = 0;
  let lastFrame = 0;
  let layoutCache = null;
  let staticCanvas = null;
  let staticCtx = null;
  let liveBuffer = null;
  let liveBufferCtx = null;
  let staticReady = false;
  let holdAlpha = 0;
  let wasLiveGrain = false;
  let layoutW = 0;
  let layoutH = 0;
  let layoutSc = 0;
  let renderSettleFrames = 0;
  let bakeIdleFrames = 0;
  let renderLive = false;
  let trackOx = 0;
  let trackOy = 0;
  let trackSc = 0;
  const mouse = {
    x: -9999,
    y: -9999,
    lx: -9999,
    ly: -9999,
    px: -9999,
    py: -9999,
    vx: 0,
    vy: 0,
    onStage: false,
    active: false,
    dwell: 0,
  };

  venn.classList.add('has-light-grain');

  function mulberry32(seed) {
    let a = seed;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let n = Math.imul(a ^ (a >>> 15), 1 | a);
      n = (n + Math.imul(n ^ (n >>> 7), 61 | n)) ^ n;
      return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
    };
  }

  function smoothstep(u) {
    const x = Math.max(0, Math.min(1, u));
    return x * x * (3 - 2 * x);
  }

  function scale() {
    return layoutCache ? layoutCache.sc : Math.min(w, h);
  }

  function stageScale() {
    return Math.min(w, h);
  }

  function updateLayoutCache() {
    const heroRect = trackEl.getBoundingClientRect();
    const vennRect = venn.getBoundingClientRect();
    const sc = Math.min(vennRect.width, vennRect.height);
    const ox = vennRect.left - heroRect.left + (vennRect.width - sc) * 0.5;
    const oy = vennRect.top - heroRect.top + (vennRect.height - sc) * 0.5;
    layoutCache = {
      sc: sc,
      ox: ox,
      oy: oy,
      centers: CHANNELS.map(function (ch) {
        return { x: ox + ch.cx * sc, y: oy + ch.cy * sc, r: ch.r * sc };
      }),
    };
  }

  function toPixel(nx, ny) {
    const lay = layoutCache;
    return { x: lay.ox + nx * lay.sc, y: lay.oy + ny * lay.sc };
  }

  function normChannelCount(nx, ny) {
    let n = 0;
    for (let i = 0; i < CHANNELS.length; i += 1) {
      const ch = CHANNELS[i];
      const dx = nx - ch.cx;
      const dy = ny - ch.cy;
      if (dx * dx + dy * dy <= ch.r * ch.r * 0.996) n += 1;
    }
    return n;
  }

  function pushParticle(rng, chIdx, nx, ny, step, alphaBase, alphaRange, rMul, overlap) {
    particles.push({
      nx: nx,
      ny: ny,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      homeX: 0,
      homeY: 0,
      chIdx: chIdx,
      overlap: overlap,
      phase: rng() * TAU,
      flutter: rng() * TAU,
      baseR: step * rMul,
      baseAlpha: alphaBase + rng() * alphaRange,
      pull: 0,
      gatherStr: 0.65 + rng() * 0.7,
      gatherOx: (rng() - 0.5) * 0.22,
      gatherOy: (rng() - 0.5) * 0.22,
      springMul: 0.82 + rng() * 0.36,
      dampMul: 0.9 + rng() * 0.14,
      flutterAmp: 0.5 + rng() * 1,
      scatterBias: (rng() - 0.5) * 0.6,
      detourSign: rng() > 0.5 ? 1 : -1,
      detourBias: 0.45 + rng() * 0.55,
      burstAng: rng() * TAU,
      detourWx: (rng() - 0.5) * 0.14,
      detourWy: (rng() - 0.5) * 0.14,
      loose: 0,
    });
  }

  function gridStep() {
    const s = scale() || 640;
    if (reduced) return 0.29 / 30;
    if (s < 420) return 0.29 / 33;
    if (s < 680) return 0.29 / 36;
    return 0.29 / 37;
  }

  function fillHexGrid(rng, chIdx, ch, step, alphaBase, alphaRange, rMul, overlapMode) {
    const rowH = step * (Math.sqrt(3) / 2);
    const jitter = step * 0.05;
    const r2 = ch.r * ch.r * 0.994;
    let row = 0;

    for (let ny = ch.cy - ch.r; ny <= ch.cy + ch.r + rowH * 0.5; ny += rowH) {
      const offset = (row % 2) * (step * 0.5);
      for (let nx = ch.cx - ch.r + offset; nx <= ch.cx + ch.r + step * 0.5; nx += step) {
        const dx = nx - ch.cx;
        const dy = ny - ch.cy;
        if (dx * dx + dy * dy > r2) continue;

        const overlap = normChannelCount(nx, ny);
        if (overlapMode === 1 && overlap !== 1) continue;
        if (overlapMode === 2 && overlap < 2) continue;

        pushParticle(
          rng,
          chIdx,
          nx + (rng() - 0.5) * jitter,
          ny + (rng() - 0.5) * jitter,
          step,
          alphaBase,
          alphaRange,
          rMul,
          overlap
        );
      }
      row += 1;
    }
  }

  function initParticles() {
    const rng = mulberry32(20260802);
    particles = [];
    const step = gridStep();

    CHANNELS.forEach(function (ch, chIdx) {
      fillHexGrid(rng, chIdx, ch, step, 0.24, 0.05, 0.66, 0);
      fillHexGrid(rng, chIdx, ch, step * 0.78, 0.21, 0.04, 0.64, 1);
      fillHexGrid(rng, chIdx, ch, step * 0.62, 0.19, 0.04, 0.62, 2);
    });
  }

  function invalidateStatic() {
    staticReady = false;
    bakeIdleFrames = 0;
  }

  function maxPull() {
    let max = 0;
    for (let i = 0; i < particles.length; i += 1) {
      if (particles[i].pull > max) max = particles[i].pull;
    }
    return max;
  }

  function snapAllHome() {
    for (let i = 0; i < particles.length; i += 1) {
      const p = particles[i];
      p.x = p.homeX;
      p.y = p.homeY;
      p.vx = 0;
      p.vy = 0;
      p.pull = 0;
      p.loose = 0;
    }
  }

  function setLiveGrainVisible(visible) {
    if (visible) trackEl.classList.add('is-live-grain');
    else trackEl.classList.remove('is-live-grain');
  }

  function isLiveGrainVisible() {
    return trackEl.classList.contains('is-live-grain');
  }

  function ensureLiveBuffer() {
    if (!liveBuffer) {
      liveBuffer = document.createElement('canvas');
      liveBufferCtx = liveBuffer.getContext('2d', { alpha: true });
    }
    const pw = Math.round(w * dpr);
    const ph = Math.round(h * dpr);
    if (liveBuffer.width !== pw || liveBuffer.height !== ph) {
      liveBuffer.width = pw;
      liveBuffer.height = ph;
    }
  }

  function captureHold() {
    if (w < 1 || h < 1) return;
    if (!staticReady && !isLiveGrainVisible()) return;
    holdCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    holdCtx.globalCompositeOperation = 'copy';
    holdCtx.clearRect(0, 0, w, h);
    holdCtx.globalCompositeOperation = 'source-over';
    holdCtx.drawImage(staticLayer, 0, 0, w, h);
    if (isLiveGrainVisible()) {
      holdCtx.globalCompositeOperation = 'lighter';
      holdCtx.drawImage(canvas, 0, 0, w, h);
      holdCtx.globalCompositeOperation = 'source-over';
    }
    holdAlpha = 1;
    holdLayer.style.opacity = String(HOLD_PEAK);
  }

  function updateHoldFade(dt) {
    if (holdAlpha <= 0) return;
    holdAlpha = Math.max(0, holdAlpha - dt / HOLD_FADE_MS);
    holdLayer.style.opacity = String(holdAlpha * HOLD_PEAK);
  }

  function noteLiveTransition(nextLiveGrain) {
    if (nextLiveGrain && !wasLiveGrain) captureHold();
    wasLiveGrain = nextLiveGrain;
  }

  function publishStatic() {
    if (!staticReady) bakeStatic();
    if (!staticReady) return;
    staticLayerCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    staticLayerCtx.globalCompositeOperation = 'copy';
    staticLayerCtx.drawImage(staticCanvas, 0, 0, w, h);
    staticLayerCtx.globalCompositeOperation = 'source-over';
  }

  function updateRenderMode(pointerActive) {
    const disp2 = maxDispSq();
    const loose = maxLoose();

    if (renderLive) {
      if (!pointerActive && disp2 < SETTLE_IN2 && loose < 0.015) {
        renderSettleFrames += 1;
        if (renderSettleFrames >= SETTLE_FRAMES_IN) {
          renderLive = false;
          renderSettleFrames = 0;
          snapAllHome();
          staticReady = false;
        }
      } else {
        renderSettleFrames = 0;
      }
      return;
    }

    renderSettleFrames = 0;
    if (disp2 > SETTLE_OUT2 || loose > 0.04) {
      renderLive = true;
    }
  }

  function trackLayoutShift() {
    if (!layoutCache) return;
    updateLayoutCache();
    const ox = layoutCache.ox;
    const oy = layoutCache.oy;
    const sc = layoutCache.sc;
    if (trackSc > 0 && Math.abs(sc - trackSc) < 1) {
      const dx = ox - trackOx;
      const dy = oy - trackOy;
      if (Math.abs(dx) > 0.25 || Math.abs(dy) > 0.25) {
        for (let i = 0; i < particles.length; i += 1) {
          const p = particles[i];
          p.homeX += dx;
          p.homeY += dy;
          p.x += dx;
          p.y += dy;
        }
      }
    }
    trackOx = ox;
    trackOy = oy;
    trackSc = sc;
  }

  function syncHomes(mode) {
    for (let i = 0; i < particles.length; i += 1) {
      const p = particles[i];
      const pt = toPixel(p.nx, p.ny);
      if (mode === 'shift') {
        const dx = pt.x - p.homeX;
        const dy = pt.y - p.homeY;
        if (dx !== 0 || dy !== 0) {
          p.x += dx;
          p.y += dy;
        }
      } else if (mode === 'full') {
        p.x = pt.x;
        p.y = pt.y;
        p.vx = 0;
        p.vy = 0;
        p.pull = 0;
        p.loose = 0;
      }
      p.homeX = pt.x;
      p.homeY = pt.y;
    }
  }

  function ensureStaticCanvas() {
    if (!staticCanvas) {
      staticCanvas = document.createElement('canvas');
      staticCtx = staticCanvas.getContext('2d', { alpha: true });
    }
    const pw = Math.round(w * dpr);
    const ph = Math.round(h * dpr);
    if (staticCanvas.width !== pw || staticCanvas.height !== ph) {
      staticCanvas.width = pw;
      staticCanvas.height = ph;
      staticReady = false;
    }
  }

  function overlapMul(overlap, atRest, pull) {
    const rest = Math.max(atRest, pull * 0.35);
    if (overlap >= 3) return 1 + rest * 0.24;
    if (overlap === 2) return 1 + rest * 0.18;
    return 1 + rest * 0.14;
  }

  function overlapSizeMul(overlap, atRest) {
    if (overlap >= 3) return 1 + atRest * 0.1;
    if (overlap === 2) return 1 + atRest * 0.07;
    return 1 + atRest * 0.06;
  }

  function drawParticleStatic(p, x, y, sc) {
    const radius = p.baseR * sc * 1.14 * overlapSizeMul(p.overlap, 1);
    const alpha = p.baseAlpha * 1.44 * overlapMul(p.overlap, 1, 0);
    staticCtx.globalAlpha = alpha;
    staticCtx.beginPath();
    staticCtx.arc(x, y, radius, 0, TAU);
    staticCtx.fill();
  }

  function liveEdge(x, y, p, pull, dwellFactor, atRest, homeDist) {
    const sc = layoutCache.sc;
    if (homeDist > sc * 0.11 || pull > 0.07 || p.loose > 0.08) return 1;
    const c = layoutCache.centers[p.chIdx];
    const dist = Math.hypot(x - c.x, y - c.y) / c.r;
    const soften = pull * 0.42 + dwellFactor * 0.28;
    if (atRest > 0.72) return smoothstep(1.0, 0.92, dist);
    if (soften < 0.001) return smoothstep(1.01, 0.88, dist);
    return smoothstep(1.04 + soften, 0.74 - soften * 0.12, dist);
  }

  function drawParticleLive(targetCtx, p, x, y, sc, atRest, pull, dwellFactor, homeDist) {
    const edge = liveEdge(x, y, p, pull, dwellFactor, atRest, homeDist);
    if (edge < 0.003) return;

    const scatter =
      smoothstep(0, sc * 0.38, homeDist) * (1 - atRest * 0.85) + p.loose * 0.55 + pull * 0.12;
    const radius =
      p.baseR *
      sc *
      (0.92 + atRest * 0.24 - pull * 0.16) *
      overlapSizeMul(p.overlap, atRest) *
      (1 - scatter * 0.48);
    const alpha =
      (p.baseAlpha * (0.92 + atRest * 0.52) + pull * 0.1 + dwellFactor * 0.02) *
      edge *
      overlapMul(p.overlap, atRest, pull) *
      (1 - scatter * 0.22);

    targetCtx.globalAlpha = alpha;
    targetCtx.beginPath();
    targetCtx.arc(x, y, radius, 0, TAU);
    targetCtx.fill();
  }

  function bakeStatic() {
    ensureStaticCanvas();
    staticCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    staticCtx.clearRect(0, 0, w, h);
    staticCtx.globalCompositeOperation = 'lighter';
    const sc = layoutCache.sc;

    for (let ci = 0; ci < CH_COLORS.length; ci += 1) {
      const c = layoutCache.centers[ci];
      staticCtx.save();
      staticCtx.beginPath();
      staticCtx.arc(c.x, c.y, c.r, 0, TAU);
      staticCtx.clip();
      staticCtx.fillStyle = CH_COLORS[ci];
      for (let i = 0; i < particles.length; i += 1) {
        const p = particles[i];
        if (p.chIdx !== ci) continue;
        drawParticleStatic(p, p.homeX, p.homeY, sc);
      }
      staticCtx.restore();
    }

    staticCtx.globalCompositeOperation = 'source-over';
    staticCtx.globalAlpha = 1;
    staticReady = true;
  }

  function resizeCanvas(el, layerCtx, pw, ph) {
    if (el.width !== pw || el.height !== ph) {
      el.width = pw;
      el.height = ph;
      el.style.width = w + 'px';
      el.style.height = h + 'px';
      layerCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return true;
    }
    return false;
  }

  function resize() {
    const rect = trackEl.getBoundingClientRect();
    const nextDpr = Math.min(window.devicePixelRatio || 1, 2);
    const nextW = Math.max(1, rect.width);
    const nextH = Math.max(1, rect.height);
    updateLayoutCache();
    const nextSc = layoutCache.sc;

    const wSame = Math.abs(nextW - layoutW) < 0.5;
    const hSame = Math.abs(nextH - layoutH) < 0.5;
    const scSame = Math.abs(nextSc - layoutSc) < 1;
    const dprSame = nextDpr === dpr;

    if (layoutW > 0 && wSame && hSame && scSame && dprSame) {
      return;
    }

    const scChanged = layoutSc > 0 && Math.abs(nextSc - layoutSc) > 6;
    const sizeChanged = !wSame || !hSame || !dprSame;

    dpr = nextDpr;
    w = nextW;
    h = nextH;
    layoutW = nextW;
    layoutH = nextH;
    layoutSc = nextSc;
    trackOx = layoutCache.ox;
    trackOy = layoutCache.oy;
    trackSc = nextSc;

    const pw = Math.round(w * dpr);
    const ph = Math.round(h * dpr);
    const staticChanged = resizeCanvas(staticLayer, staticLayerCtx, pw, ph);
    const liveChanged = resizeCanvas(canvas, ctx, pw, ph);
    const holdChanged = resizeCanvas(holdLayer, holdCtx, pw, ph);
    if (staticChanged || liveChanged || holdChanged) {
      staticReady = false;
      holdAlpha = 0;
      holdLayer.style.opacity = '0';
    }

    if (scChanged) {
      initParticles();
      syncHomes('full');
      invalidateStatic();
      renderLive = false;
      setLiveGrainVisible(false);
    } else if (!scSame || sizeChanged) {
      syncHomes('shift');
    }

    if (!staticReady && layoutCache && layoutCache.sc > 48) {
      bakeStatic();
      publishStatic();
    }
  }

  function gatherRadius(dwellFactor) {
    return layoutCache.sc * GATHER_R * (1 + dwellFactor * 0.1);
  }

  function stageGatherRadius() {
    return stageScale() * STAGE_GATHER_R;
  }

  function maxDriftPx(p, pull, dwellFactor) {
    const sc = layoutCache.sc;
    const ss = stageScale();
    const base = sc * (MAX_DRIFT + pull * 0.38 + dwellFactor * 0.14);
    const stageExtra = p.loose * ss * 0.32 + pull * ss * 0.08;
    return base + stageExtra;
  }

  function maxDispSq() {
    let max = 0;
    for (let i = 0; i < particles.length; i += 1) {
      const p = particles[i];
      const dx = p.x - p.homeX;
      const dy = p.y - p.homeY;
      const d2 = dx * dx + dy * dy;
      if (d2 > max) max = d2;
    }
    return max;
  }

  function maxLoose() {
    let max = 0;
    for (let i = 0; i < particles.length; i += 1) {
      if (particles[i].loose > max) max = particles[i].loose;
    }
    return max;
  }

  function updateDwell(dt) {
    if (!mouse.onStage) {
      mouse.dwell = 0;
      return 0;
    }
    if (mouse.lx < -9000) {
      mouse.lx = mouse.x;
      mouse.ly = mouse.y;
    }
    const moved = Math.hypot(mouse.x - mouse.lx, mouse.y - mouse.ly);
    if (moved < DWELL_MOVE_PX) {
      mouse.dwell = Math.min(mouse.dwell + dt, DWELL_MS + 600);
    } else {
      mouse.dwell = 0;
      mouse.lx = mouse.x;
      mouse.ly = mouse.y;
    }
    return smoothstep((mouse.dwell - DWELL_MS) / 380);
  }

  function updatePointer(clientX, clientY) {
    const rect = trackEl.getBoundingClientRect();
    const nx = clientX - rect.left;
    const ny = clientY - rect.top;
    if (mouse.px > -9000) {
      mouse.vx = nx - mouse.px;
      mouse.vy = ny - mouse.py;
    } else {
      mouse.vx = 0;
      mouse.vy = 0;
    }
    mouse.px = nx;
    mouse.py = ny;
    mouse.x = nx;
    mouse.y = ny;
    mouse.onStage =
      clientX >= rect.left &&
      clientX <= rect.right &&
      clientY >= rect.top &&
      clientY <= rect.bottom;
    const vRect = venn.getBoundingClientRect();
    mouse.active =
      clientX >= vRect.left &&
      clientX <= vRect.right &&
      clientY >= vRect.top &&
      clientY <= vRect.bottom;
  }

  function releaseBurst() {
    const ss = stageScale();
    renderLive = true;
    staticReady = false;
    renderSettleFrames = 0;
    for (let i = 0; i < particles.length; i += 1) {
      const p = particles[i];
      if (p.pull < 0.05 && p.loose < 0.08) continue;
      const hx = p.homeX - p.x;
      const hy = p.homeY - p.y;
      const d2 = hx * hx + hy * hy;
      if (d2 < 12) continue;
      const d = Math.sqrt(d2) || 0.001;
      const inv = 1 / d;
      const bx = Math.cos(p.burstAng);
      const by = Math.sin(p.burstAng);
      const kick = ss * (0.0088 + p.detourBias * 0.0065) * (0.75 + p.pull * 0.65);
      p.vx += (bx * 0.85 - hx * inv * 0.28) * kick;
      p.vy += (by * 0.85 - hy * inv * 0.28) * kick;
      p.vx += -hy * inv * p.detourSign * kick * 0.82;
      p.vy += hx * inv * p.detourSign * kick * 0.82;
      p.vx += mouse.vx * 0.034 * (0.55 + p.pull);
      p.vy += mouse.vy * 0.034 * (0.55 + p.pull);
      p.loose = Math.max(p.loose, 0.94 + p.pull * 0.06);
    }
  }

  function onPointerMove(e) {
    const wasOnStage = mouse.onStage;
    updatePointer(e.clientX, e.clientY);
    if (wasOnStage && !mouse.onStage) releaseBurst();
  }

  function onPointerLeave() {
    if (mouse.onStage) releaseBurst();
    mouse.onStage = false;
    mouse.active = false;
    mouse.x = -9999;
    mouse.y = -9999;
    mouse.lx = -9999;
    mouse.ly = -9999;
    mouse.px = -9999;
    mouse.py = -9999;
    mouse.vx = 0;
    mouse.vy = 0;
    mouse.dwell = 0;
  }

  function clampDrift(p, pull, dwellFactor) {
    const dx = p.x - p.homeX;
    const dy = p.y - p.homeY;
    const dist = Math.hypot(dx, dy);
    const maxD = maxDriftPx(p, pull, dwellFactor) * (0.85 + p.gatherStr * 0.22);
    if (dist > maxD) {
      p.x = p.homeX + (dx / dist) * maxD;
      p.y = p.homeY + (dy / dist) * maxD;
      p.vx *= 0.38;
      p.vy *= 0.38;
    }
  }

  function simulate(dwellFactor) {
    const gR = gatherRadius(dwellFactor);
    const gR2 = gR * gR;
    const sGR = stageGatherRadius();
    const sGR2 = sGR * sGR;
    const mx = mouse.x;
    const my = mouse.y;
    const gatherMul = 1 + dwellFactor * 0.22;
    const sc = layoutCache.sc;
    const ss = stageScale();
    const activeR2 = (gR + ss * 0.08) * (gR + ss * 0.08);
    const mSpeed = Math.hypot(mouse.vx, mouse.vy);
    const mvx = mSpeed > 0.01 ? mouse.vx / mSpeed : 0;
    const mvy = mSpeed > 0.01 ? mouse.vy / mSpeed : 0;

    for (let i = 0; i < particles.length; i += 1) {
      const p = particles[i];
      let fx = 0;
      let fy = 0;
      let pull = 0;
      let hx = p.homeX - p.x;
      let hy = p.homeY - p.y;
      const disp2 = hx * hx + hy * hy;
      const gs = p.gatherStr;

      if (mouse.onStage) {
        const gx = mx + p.gatherOx * sc;
        const gy = my + p.gatherOy * sc;
        const dx = gx - p.x;
        const dy = gy - p.y;
        const dist2 = dx * dx + dy * dy;

        if (dist2 < sGR2) {
          const dist = Math.sqrt(dist2) || 0.001;
          const stagePull = smoothstep(1 - dist / sGR) * 0.55;
          pull = Math.max(pull, stagePull);
          fx += dx * STAGE_GATHER * gatherMul * stagePull * gs;
          fy += dy * STAGE_GATHER * gatherMul * stagePull * gs;
        }

        const dxm = p.x - mx;
        const dym = p.y - my;
        const near = dxm * dxm + dym * dym < activeR2;

        if (near && dist2 < gR2) {
          const dist = Math.sqrt(dist2) || 0.001;
          const localPull = smoothstep(1 - dist / gR);
          pull = Math.max(pull, localPull);
          fx += dx * GATHER * gatherMul * localPull * gs;
          fy += dy * GATHER * gatherMul * localPull * gs;
          p.vx += dx * FLOW * gatherMul * localPull * gs;
          p.vy += dy * FLOW * gatherMul * localPull * gs;

          if (mSpeed > 0.4) {
            p.vx += mvx * mSpeed * 0.013 * localPull * gs;
            p.vy += mvy * mSpeed * 0.013 * localPull * gs;
            const tx = -mvy;
            const ty = mvx;
            const trail = (p.scatterBias + 0.5) * localPull * mSpeed * 0.002;
            fx += tx * trail;
            fy += ty * trail;
          }

          const inv = 1 / dist;
          const tx = -dy * inv;
          const ty = dx * inv;
          const swirl = (p.scatterBias + Math.sin(t * 2.1 + p.flutter) * 0.35) * pull * 0.11;
          fx += tx * swirl;
          fy += ty * swirl;
          fx += Math.sin(t * 2.8 + p.flutter) * 0.045 * pull * p.flutterAmp;
          fy += Math.cos(t * 2.3 + p.phase) * 0.045 * pull * p.flutterAmp;
        } else if (disp2 < 1 && p.vx * p.vx + p.vy * p.vy < 0.02 && p.loose < 0.02) {
          p.pull *= 0.85;
          continue;
        }
      }

      const spring = SPRING * p.springMul * (1 - pull * (0.55 + dwellFactor * 0.18));
      const toHomeX = p.homeX - p.x;
      const toHomeY = p.homeY - p.y;
      const homeDist = Math.sqrt(toHomeX * toHomeX + toHomeY * toHomeY) || 0.001;
      hx = toHomeX;
      hy = toHomeY;
      let springDirect = 1;

      if (p.loose > 0.004) p.loose *= 0.991;

      if (pull < 0.1 && homeDist > 2.5) {
        const magnet = smoothstep(ss * 0.42, sc * 0.015, homeDist);
        const free = p.loose * (1 - magnet * 0.82);
        const springMag = (0.14 + magnet * 0.86) * (1 - free * 0.62);

        if (free > 0.06) {
          hx = p.homeX + p.detourWx * sc * free - p.x;
          hy = p.homeY + p.detourWy * sc * free - p.y;
        }

        if (homeDist > 3.5) {
          const detour = smoothstep(3.5, ss * 0.38, homeDist) * (1 - pull) * p.detourBias;
          springDirect = 1 - detour * 0.32 - free * 0.28;
          const inv = 1 / homeDist;
          const tx = -toHomeY * inv;
          const ty = toHomeX * inv;
          const curve =
            Math.sin(t * 0.85 + p.phase) * 0.6 + Math.sin(t * 1.45 + p.flutter) * 0.4;
          const tang = curve * p.detourSign * (detour * 0.095 + free * 0.072);
          fx += tx * tang;
          fy += ty * tang;
        }

        if (free > 0.04) {
          fx += Math.sin(t * 1.55 + p.flutter) * free * 0.042;
          fy += Math.cos(t * 1.35 + p.phase) * free * 0.042;
        }

        fx += hx * spring * springDirect * springMag;
        fy += hy * spring * springDirect * springMag;
      } else {
        fx += hx * spring * springDirect;
        fy += hy * spring * springDirect;
      }

      const damp = DAMP * p.dampMul;
      p.vx = (p.vx + fx) * damp;
      p.vy = (p.vy + fy) * damp;
      p.x += p.vx;
      p.y += p.vy;
      clampDrift(p, pull, dwellFactor);
      p.pull += (pull - p.pull) * 0.085;
    }
  }

  function drawLive(targetCtx, dwellFactor) {
    const sc = layoutCache.sc;
    targetCtx.globalCompositeOperation = 'lighter';

    for (let ci = 0; ci < CH_COLORS.length; ci += 1) {
      targetCtx.fillStyle = CH_COLORS[ci];
      for (let i = 0; i < particles.length; i += 1) {
        const p = particles[i];
        if (p.chIdx !== ci) continue;
        const dx = p.x - p.homeX;
        const dy = p.y - p.homeY;
        const homeDist = Math.hypot(dx, dy);
        const atRest =
          smoothstep(10, 0, homeDist) * (1 - p.pull * 0.85) * (1 - dwellFactor * 0.9);
        drawParticleLive(targetCtx, p, p.x, p.y, sc, atRest, p.pull, dwellFactor, homeDist);
      }
    }

    targetCtx.globalCompositeOperation = 'source-over';
    targetCtx.globalAlpha = 1;
  }

  function publishLiveFrame(dwellFactor) {
    ensureLiveBuffer();
    liveBufferCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    liveBufferCtx.clearRect(0, 0, w, h);
    drawLive(liveBufferCtx, dwellFactor);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = 'copy';
    ctx.drawImage(liveBuffer, 0, 0, w, h);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = lastFrame ? Math.min(32, now - lastFrame) : 16;
    lastFrame = now;
    t += dt * 0.001;

    const dwellFactor = updateDwell(dt);
    trackLayoutShift();
    const pointerActive = mouse.onStage || dwellFactor > 0.001;
    const needsSim = pointerActive || renderLive || maxLoose() > 0.008;

    if (needsSim) {
      simulate(dwellFactor);
    }

    updateRenderMode(pointerActive);

    const exitingLive = wasLiveGrain && !renderLive;
    noteLiveTransition(renderLive);

    if (renderLive) {
      publishLiveFrame(dwellFactor);
      setLiveGrainVisible(true);
      staticReady = false;
    } else {
      if (exitingLive) {
        holdAlpha = 0;
        holdLayer.style.opacity = '0';
      }
      if (!staticReady || exitingLive) {
        bakeStatic();
        publishStatic();
      }
      setLiveGrainVisible(false);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalCompositeOperation = 'copy';
      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'source-over';
    }

    updateHoldFade(dt);

    if (!renderLive && !pointerActive && maxDispSq() < SETTLE_IN2) {
      bakeIdleFrames += 1;
      if (bakeIdleFrames >= 18 && !staticReady) {
        bakeStatic();
        publishStatic();
      }
    } else {
      bakeIdleFrames = 0;
    }
  }

  function drawStatic() {
    updateLayoutCache();
    syncHomes('full');
    bakeStatic();
    publishStatic();
    setLiveGrainVisible(false);
    ctx.clearRect(0, 0, w, h);
  }

  let resizeRaf = 0;

  function scheduleResize() {
    if (resizeRaf) return;
    resizeRaf = requestAnimationFrame(function () {
      resizeRaf = 0;
      resize();
    });
  }

  updateLayoutCache();
  initParticles();
  resize();

  if (!reduced) {
    bakeStatic();
    publishStatic();
  }

  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(scheduleResize).observe(trackEl);
  } else {
    window.addEventListener('resize', scheduleResize);
  }

  trackEl.addEventListener('pointermove', onPointerMove, { passive: true });
  trackEl.addEventListener('pointerleave', onPointerLeave, { passive: true });

  if (reduced) {
    drawStatic();
  } else {
    frame();
  }

  document.addEventListener('visibilitychange', function () {
    if (reduced) return;
    if (document.hidden) {
      cancelAnimationFrame(raf);
      raf = 0;
    } else if (!raf) {
      frame();
    }
  });
})();
