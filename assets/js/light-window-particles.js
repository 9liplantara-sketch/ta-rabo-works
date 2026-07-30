/* 光の窳 — 1層の光粒で RGB ベン図。静止時キャッシュ + 事前計算で軽量化 */
(function () {
  const venn = document.getElementById('venn');
  const canvas = document.getElementById('light-grain');
  if (!venn || !canvas) return;

  const stage = document.querySelector('.stage') || venn;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ctx = canvas.getContext('2d', { alpha: true });

  const CHANNELS = [
    { color: '#ff0000', cx: 0.344, cy: 0.365, r: 0.29 },
    { color: '#00ff00', cx: 0.656, cy: 0.365, r: 0.29 },
    { color: '#0000ff', cx: 0.5, cy: 0.635, r: 0.29 },
  ];
  const CH_COLORS = ['#ff0000', '#00ff00', '#0000ff'];
  const TAU = Math.PI * 2;
  const SETTLE_D2 = 6;

  const SPRING = 0.052;
  const DAMP = 0.889;
  const GATHER = 0.046;
  const FLOW = 0.0085;
  const MAX_DRIFT = 0.1;
  const GATHER_R = 0.39;
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
  let staticReady = false;
  let settleFrames = 0;
  const mouse = {
    x: -9999,
    y: -9999,
    lx: -9999,
    ly: -9999,
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
    return Math.min(w, h);
  }

  function updateLayoutCache() {
    const sc = scale();
    const ox = (w - sc) * 0.5;
    const oy = (h - sc) * 0.5;
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
      gatherOx: (rng() - 0.5) * 0.1,
      gatherOy: (rng() - 0.5) * 0.1,
      springMul: 0.82 + rng() * 0.36,
      dampMul: 0.9 + rng() * 0.14,
      flutterAmp: 0.5 + rng() * 1,
      scatterBias: (rng() - 0.5) * 0.6,
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
    settleFrames = 0;
  }

  function syncHomes(reset) {
    for (let i = 0; i < particles.length; i += 1) {
      const p = particles[i];
      const pt = toPixel(p.nx, p.ny);
      p.homeX = pt.x;
      p.homeY = pt.y;
      if (reset) {
        p.x = p.homeX;
        p.y = p.homeY;
        p.vx = 0;
        p.vy = 0;
        p.pull = 0;
      }
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

  function liveEdge(x, y, chIdx, pull, dwellFactor, atRest) {
    const c = layoutCache.centers[chIdx];
    const dist = Math.hypot(x - c.x, y - c.y) / c.r;
    const soften = pull * 0.42 + dwellFactor * 0.28;
    if (atRest > 0.72) return smoothstep(1.0, 0.92, dist);
    if (soften < 0.001) return smoothstep(1.01, 0.88, dist);
    return smoothstep(1.04 + soften, 0.74 - soften * 0.12, dist);
  }

  function drawParticleLive(p, x, y, sc, atRest, pull, dwellFactor) {
    const edge = liveEdge(x, y, p.chIdx, pull, dwellFactor, atRest);
    if (edge < 0.003) return;

    const radius =
      p.baseR * sc * (0.92 + atRest * 0.24 - pull * 0.16) * overlapSizeMul(p.overlap, atRest);
    const alpha =
      (p.baseAlpha * (0.92 + atRest * 0.52) + pull * 0.12 + dwellFactor * 0.02) *
      edge *
      overlapMul(p.overlap, atRest, pull);

    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, TAU);
    ctx.fill();
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

  function resize() {
    const rect = venn.getBoundingClientRect();
    const prevSc = scale();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = Math.max(1, rect.width);
    h = Math.max(1, rect.height);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    updateLayoutCache();
    if (Math.abs(scale() - prevSc) > 6) {
      initParticles();
    }
    syncHomes(true);
    invalidateStatic();
  }

  function gatherRadius(dwellFactor) {
    return layoutCache.sc * GATHER_R * (1 + dwellFactor * 0.1);
  }

  function maxDriftPx(pull, dwellFactor) {
    return layoutCache.sc * (MAX_DRIFT + pull * 0.2 + dwellFactor * 0.14);
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

  function updateDwell(dt) {
    if (!mouse.active) {
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
    const rect = venn.getBoundingClientRect();
    mouse.x = clientX - rect.left;
    mouse.y = clientY - rect.top;
    mouse.active =
      clientX >= rect.left &&
      clientX <= rect.right &&
      clientY >= rect.top &&
      clientY <= rect.bottom;
  }

  function onPointerMove(e) {
    updatePointer(e.clientX, e.clientY);
    if (mouse.active) invalidateStatic();
  }

  function onPointerLeave() {
    mouse.active = false;
    mouse.x = -9999;
    mouse.y = -9999;
    mouse.lx = -9999;
    mouse.ly = -9999;
    mouse.dwell = 0;
  }

  function clampDrift(p, pull, dwellFactor) {
    const dx = p.x - p.homeX;
    const dy = p.y - p.homeY;
    const dist = Math.hypot(dx, dy);
    const maxD = maxDriftPx(pull, dwellFactor) * (0.85 + p.gatherStr * 0.22);
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
    const mx = mouse.x;
    const my = mouse.y;
    const gatherMul = 1 + dwellFactor * 0.22;
    const sc = layoutCache.sc;
    const activeR2 = (gR + sc * 0.12) * (gR + sc * 0.12);

    for (let i = 0; i < particles.length; i += 1) {
      const p = particles[i];
      let fx = 0;
      let fy = 0;
      let pull = 0;
      const hx = p.homeX - p.x;
      const hy = p.homeY - p.y;
      const disp2 = hx * hx + hy * hy;
      const gs = p.gatherStr;

      if (mouse.active) {
        const dxm = p.x - mx;
        const dym = p.y - my;
        const near = dxm * dxm + dym * dym < activeR2;

        if (near) {
          const gx = mx + p.gatherOx * sc;
          const gy = my + p.gatherOy * sc;
          const dx = gx - p.x;
          const dy = gy - p.y;
          const dist2 = dx * dx + dy * dy;
          if (dist2 < gR2) {
            const dist = Math.sqrt(dist2) || 0.001;
            pull = smoothstep(1 - dist / gR);
            fx += dx * GATHER * gatherMul * pull * gs;
            fy += dy * GATHER * gatherMul * pull * gs;
            p.vx += dx * FLOW * gatherMul * pull * gs;
            p.vy += dy * FLOW * gatherMul * pull * gs;

            const inv = 1 / dist;
            const tx = -dy * inv;
            const ty = dx * inv;
            const swirl = (p.scatterBias + Math.sin(t * 2.1 + p.flutter) * 0.35) * pull * 0.11;
            fx += tx * swirl;
            fy += ty * swirl;
            fx += Math.sin(t * 2.8 + p.flutter) * 0.045 * pull * p.flutterAmp;
            fy += Math.cos(t * 2.3 + p.phase) * 0.045 * pull * p.flutterAmp;
          }
        } else if (disp2 < 1 && p.vx * p.vx + p.vy * p.vy < 0.02) {
          p.pull *= 0.85;
          continue;
        }
      }

      const spring = SPRING * p.springMul * (1 - pull * (0.55 + dwellFactor * 0.18));
      fx += hx * spring;
      fy += hy * spring;

      const damp = DAMP * p.dampMul;
      p.vx = (p.vx + fx) * damp;
      p.vy = (p.vy + fy) * damp;
      p.x += p.vx;
      p.y += p.vy;
      clampDrift(p, pull, dwellFactor);
      p.pull += (pull - p.pull) * 0.085;
    }
  }

  function drawLive(dwellFactor) {
    const sc = layoutCache.sc;
    ctx.globalCompositeOperation = 'lighter';

    for (let ci = 0; ci < CH_COLORS.length; ci += 1) {
      ctx.fillStyle = CH_COLORS[ci];
      for (let i = 0; i < particles.length; i += 1) {
        const p = particles[i];
        if (p.chIdx !== ci) continue;
        const dx = p.x - p.homeX;
        const dy = p.y - p.homeY;
        const atRest =
          smoothstep(10, 0, Math.hypot(dx, dy)) * (1 - p.pull * 0.85) * (1 - dwellFactor * 0.9);
        drawParticleLive(p, p.x, p.y, sc, atRest, p.pull, dwellFactor);
      }
    }

    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = lastFrame ? Math.min(32, now - lastFrame) : 16;
    lastFrame = now;
    t += dt * 0.001;

    const dwellFactor = updateDwell(dt);
    const interacting = mouse.active || dwellFactor > 0.001;

    if (!interacting) {
      const disp2 = maxDispSq();
      if (disp2 < SETTLE_D2) {
        settleFrames += 1;
        if (!staticReady) bakeStatic();
        ctx.clearRect(0, 0, w, h);
        ctx.drawImage(staticCanvas, 0, 0, w, h);
        return;
      }
      settleFrames = 0;
    } else {
      settleFrames = 0;
      staticReady = false;
    }

    ctx.clearRect(0, 0, w, h);
    simulate(dwellFactor);
    drawLive(dwellFactor);

    if (!interacting && maxDispSq() < SETTLE_D2) {
      settleFrames += 1;
      if (settleFrames >= 8) bakeStatic();
    }
  }

  function drawStatic() {
    updateLayoutCache();
    syncHomes(true);
    bakeStatic();
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(staticCanvas, 0, 0, w, h);
  }

  updateLayoutCache();
  initParticles();
  resize();

  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(resize).observe(venn);
  } else {
    window.addEventListener('resize', resize);
  }

  stage.addEventListener('pointermove', onPointerMove, { passive: true });
  stage.addEventListener('pointerleave', onPointerLeave, { passive: true });

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
