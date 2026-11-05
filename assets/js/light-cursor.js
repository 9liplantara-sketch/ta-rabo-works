/* 光の粒カーソル — 白い粒が分かれ、曲線でカーソルへ集まる */
(function () {
  const fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!fine || reduced) return;

  const GRAINS = 26;
  const TRAIL_MAX = 16;
  const TEXT_SEL = 'p, h1, h2, h3, h4, h5, h6, li, a, button, label, figcaption, blockquote, td, th, summary, .lbl, .sub, .policy-split-text, .policy-hero-title, .policy-hero-lead, .policy-section-title, .page-title, .page-sub, .nav-item';

  const css = document.createElement('style');
  css.textContent = [
    'html.lw-cursor-on, html.lw-cursor-on * { cursor: none !important; }',
    'html.lw-cursor-on input, html.lw-cursor-on textarea, html.lw-cursor-on select, html.lw-cursor-on option { cursor: text !important; }',
    '#lw-cursor-root { position: fixed; inset: 0; width: 100%; height: 100%; pointer-events: none; z-index: 2147483000; }',
    '.lw-text-lit { filter: brightness(1.36); }',
    'html.lw-cursor-on :is(p, h1, h2, h3, h4, h5, h6, li, a, button, label, figcaption, blockquote, .lbl, .sub, .policy-split-text, .policy-hero-title, .policy-hero-lead, .policy-section-title, .page-title, .page-sub, .nav-item) {',
    '  transition: filter .7s ease, color .18s ease, background-color .18s ease, border-color .18s ease, opacity .18s ease;',
    '}'
  ].join('\n');
  document.head.appendChild(css);

  const canvas = document.createElement('canvas');
  canvas.id = 'lw-cursor-root';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d', { alpha: true });

  const mouse = { x: -100, y: -100 };
  const grains = [];
  for (let i = 0; i < GRAINS; i++) {
    const turn = i % 2 === 0 ? 1 : -1;
    grains.push({
      x: -100,
      y: -100,
      vx: 0,
      vy: 0,
      heading: (i / GRAINS) * Math.PI * 2,
      spin: turn * (0.012 + (i % 5) * 0.004),
      side: turn,
      drift: 0.28 + (i % 4) * 0.1,
      maxSpeed: 3.2 + (i % 6) * 0.55,
      force: 0.18 + (i % 5) * 0.05,
      radius: 1.15 + (i % 4) * 0.42,
      alpha: 0.42 + (i % 3) * 0.16
    });
  }
  const trail = [];
  let dpr = 1;
  let viewW = 0;
  let viewH = 0;
  let raf = 0;
  let lastFrame = 0;
  let lastMove = 0;
  let gather = 1;
  let bloom = 0;
  let inside = false;
  let seeded = false;
  let lit = null;
  let litTimer = 0;
  let hideForField = false;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    viewW = window.innerWidth;
    viewH = window.innerHeight;
    canvas.width = Math.max(1, Math.round(viewW * dpr));
    canvas.height = Math.max(1, Math.round(viewH * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function dot(x, y, radius, alpha) {
    if (alpha <= 0.02) return;
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  function fieldTarget(node) {
    return node && node.nodeType === 1 && node.closest('input, textarea, select, [contenteditable="true"]');
  }

  function textTarget(node) {
    if (!node || node.nodeType !== 1) return null;
    if (fieldTarget(node)) return null;
    const el = node.closest(TEXT_SEL);
    if (!el || !(el.textContent || '').trim()) return null;
    return el;
  }

  function setLit(el) {
    if (el === lit) return;
    if (lit) {
      const prev = lit;
      prev.classList.remove('lw-text-lit');
      window.clearTimeout(litTimer);
      litTimer = window.setTimeout(function () {
        if (prev !== lit) prev.style.removeProperty('filter');
      }, 760);
    }
    lit = el;
    if (lit) lit.classList.add('lw-text-lit');
  }

  function stop() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    ctx.clearRect(0, 0, viewW, viewH);
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = lastFrame ? Math.min(34, now - lastFrame) : 16;
    lastFrame = now;
    const still = now - lastMove > 140;
    if (still) gather = Math.min(1, gather + dt / 520);
    else gather = Math.max(0, gather - dt / 180);
    if (still) bloom = Math.min(1, bloom + dt / 720);
    else bloom = Math.max(0, bloom - dt / 220);

    const open = 1 - gather;
    for (let i = 0; i < grains.length; i++) {
      const p = grains[i];
      p.heading += p.spin * (0.35 + open * 1.4);
      const orbit = open * (26 + (i % 6) * 9);
      const tx = mouse.x + Math.cos(p.heading) * orbit;
      const ty = mouse.y + Math.sin(p.heading) * orbit;
      let dx = tx - p.x;
      let dy = ty - p.y;
      const dist = Math.hypot(dx, dy) || 1;
      const desired = still ? Math.min(dist, 2.4 + gather * 7) : Math.min(dist, p.maxSpeed);
      const desiredVx = (dx / dist) * desired;
      const desiredVy = (dy / dist) * desired;
      let steerX = desiredVx - p.vx;
      let steerY = desiredVy - p.vy;
      const steerLen = Math.hypot(steerX, steerY) || 1;
      const maxForce = p.force * (0.4 + gather * 4.2);
      if (steerLen > maxForce) {
        steerX = (steerX / steerLen) * maxForce;
        steerY = (steerY / steerLen) * maxForce;
      }
      p.vx += steerX;
      p.vy += steerY;
      if (!still) {
        p.vx += (-dy / dist) * p.side * p.drift;
        p.vy += (dx / dist) * p.side * p.drift;
      }
      p.vx *= still ? 0.84 : 0.93;
      p.vy *= still ? 0.84 : 0.93;
      p.x += p.vx;
      p.y += p.vy;
    }

    ctx.clearRect(0, 0, viewW, viewH);
    if (!inside || hideForField) return;

    ctx.fillStyle = 'rgb(255,255,255)';
    ctx.globalCompositeOperation = 'lighter';

    for (let i = trail.length - 1; i >= 0; i--) {
      const pt = trail[i];
      pt.x += pt.vx;
      pt.y += pt.vy;
      pt.vx *= 0.96;
      pt.vy *= 0.96;
      pt.life -= still ? 0.035 : 0.05;
      if (pt.life <= 0) {
        trail.splice(i, 1);
        continue;
      }
      dot(pt.x, pt.y, pt.r, pt.life * 0.55);
    }

    for (let i = 0; i < grains.length; i++) {
      const p = grains[i];
      const pulse = 0.86 + 0.14 * Math.sin(now * 0.008 + p.heading);
      dot(p.x, p.y, p.radius * (1 + bloom * 0.7), p.alpha * pulse);
    }
    dot(mouse.x, mouse.y, 1.05, 0.95);

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  function ensure() {
    if (!raf) {
      lastFrame = 0;
      raf = requestAnimationFrame(frame);
    }
  }

  function onMove(e) {
    if (e.pointerType && e.pointerType !== 'mouse') return;
    if (!canvas.isConnected) document.body.appendChild(canvas);
    inside = true;
    document.documentElement.classList.add('lw-cursor-on');
    hideForField = !!fieldTarget(e.target);
    const dx = e.clientX - mouse.x;
    const dy = e.clientY - mouse.y;
    if (!seeded) {
      grains.forEach(function (p) {
        p.x = e.clientX + Math.cos(p.heading) * 10;
        p.y = e.clientY + Math.sin(p.heading) * 10;
        p.vx = 0;
        p.vy = 0;
      });
      seeded = true;
    }
    mouse.x = e.clientX;
    mouse.y = e.clientY;
    lastMove = performance.now();
    if (!hideForField && dx * dx + dy * dy > 36 && trail.length < TRAIL_MAX) {
      const ang = Math.atan2(dy, dx);
      const bend = (trail.length % 2 === 0 ? 1 : -1) * (0.8 + (trail.length % 3) * 0.45);
      const speed = 0.7 + (trail.length % 4) * 0.25;
      trail.push({
        x: mouse.x,
        y: mouse.y,
        vx: Math.cos(ang + bend) * speed,
        vy: Math.sin(ang + bend) * speed,
        life: 1,
        r: (1.05 + (trail.length % 3) * 0.35) * 1.2
      });
    }
    setLit(hideForField ? null : textTarget(e.target));
    ensure();
  }

  function onLeave(e) {
    if (e.relatedTarget) return;
    inside = false;
    document.documentElement.classList.remove('lw-cursor-on');
    setLit(null);
    stop();
  }

  resize();
  window.addEventListener('resize', resize);
  window.addEventListener('pointermove', onMove, { passive: true });
  window.addEventListener('pointerleave', onLeave);
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      inside = false;
      setLit(null);
      stop();
    }
  });
  document.addEventListener('ta-rabo:auth-unlocked', function () {
    if (!canvas.isConnected) document.body.appendChild(canvas);
    resize();
  });
})();
