/* 光の窓 — 下部スペクトラム・スクロール進行バー（index.html 以外） */
(function () {
  const path = (location.pathname || '').split('/').pop() || 'index.html';
  if (path === '' || path === 'index.html') return;

  const BAR_H = 4;
  const FADE_PX = 5;
  const CORE_PX = 14;

  const SPECTRUM =
    'linear-gradient(90deg,' +
    '#9333ea 0%,' +
    '#6366f1 11%,' +
    '#2563eb 22%,' +
    '#06b6d4 34%,' +
    '#22c55e 46%,' +
    '#a3e635 54%,' +
    '#eab308 64%,' +
    '#f97316 76%,' +
    '#ec4899 88%,' +
    '#9333ea 100%)';

  const bandMask = `
    linear-gradient(
      to right,
      transparent max(0px, calc(var(--lw-p, 0%) - ${CORE_PX + FADE_PX}px)),
      #000 max(0px, calc(var(--lw-p, 0%) - ${CORE_PX}px)),
      #000 min(100%, calc(var(--lw-p, 0%) + ${CORE_PX}px)),
      transparent min(100%, calc(var(--lw-p, 0%) + ${CORE_PX + FADE_PX}px))
    )
  `;

  const css = `
    :root { --lw-nav-h: ${BAR_H}px; }
    html.has-lw-scroll,
    body.has-lw-scroll {
      scrollbar-width: none;
    }
    html.has-lw-scroll::-webkit-scrollbar,
    body.has-lw-scroll::-webkit-scrollbar {
      display: none;
      width: 0;
      height: 0;
    }
    body.has-lw-scroll .page-body {
      scrollbar-width: none;
    }
    body.has-lw-scroll .page-body::-webkit-scrollbar {
      display: none;
      width: 0;
      height: 0;
    }
    body.has-lw-scroll { padding-bottom: 0; }
    #lw-nav { display: none !important; }
    #lw-scroll {
      position: fixed;
      left: 0;
      right: 0;
      bottom: 0;
      height: ${BAR_H}px;
      z-index: 10040;
      pointer-events: none;
      overflow: hidden;
    }
    /* 完成した虹（常時・約80%） */
    #lw-scroll .lw-scroll-base {
      position: absolute;
      inset: 0;
      background: ${SPECTRUM};
      opacity: 0.8;
      filter: saturate(1.08);
    }
    /* 現在位置だけ明るさが脈動して輝く */
    #lw-scroll .lw-scroll-active {
      position: absolute;
      inset: 0;
      background: ${SPECTRUM};
      opacity: 1;
      -webkit-mask-image: ${bandMask};
      mask-image: ${bandMask};
      animation: lw-glow-pulse 2.4s ease-in-out infinite;
    }
    #lw-scroll .lw-scroll-shimmer {
      position: absolute;
      inset: 0;
      background: linear-gradient(
        90deg,
        transparent 0%,
        rgba(255,255,255,.08) 40%,
        rgba(255,255,255,.42) 50%,
        rgba(255,255,255,.08) 60%,
        transparent 100%
      );
      mix-blend-mode: screen;
      -webkit-mask-image: ${bandMask};
      mask-image: ${bandMask};
      animation: lw-shimmer-pulse 2.4s ease-in-out infinite;
      pointer-events: none;
    }
    @keyframes lw-glow-pulse {
      0%, 100% {
        filter: brightness(0.78) saturate(1.05);
        box-shadow: 0 0 4px rgba(0,0,0,.25);
      }
      50% {
        filter: brightness(1.28) saturate(1.22);
        box-shadow:
          0 0 8px rgba(255,255,255,.35),
          0 0 16px rgba(147,51,234,.22),
          0 0 24px rgba(6,182,212,.14);
      }
    }
    @keyframes lw-shimmer-pulse {
      0%, 100% { opacity: 0.15; }
      50% { opacity: 0.85; }
    }
    @media (prefers-reduced-motion: reduce) {
      #lw-scroll .lw-scroll-active {
        animation: none;
        filter: brightness(1.2) saturate(1.15);
      }
      #lw-scroll .lw-scroll-shimmer { animation: none; opacity: 0.45; }
    }
  `;

  document.getElementById('lw-nav')?.remove();
  document.getElementById('lw-scroll')?.remove();
  document.querySelectorAll('style[data-lw-scroll]').forEach(function (el) {
    el.remove();
  });

  const style = document.createElement('style');
  style.setAttribute('data-lw-scroll', '1');
  style.textContent = css;
  document.head.appendChild(style);
  document.documentElement.classList.add('has-lw-scroll');
  document.body.classList.add('has-lw-scroll');
  document.body.classList.remove('has-lw-nav');

  const bar = document.createElement('div');
  bar.id = 'lw-scroll';
  bar.setAttribute('role', 'progressbar');
  bar.setAttribute('aria-label', 'ページの読了位置');
  bar.setAttribute('aria-valuemin', '0');
  bar.setAttribute('aria-valuemax', '100');
  bar.setAttribute('aria-valuenow', '0');
  bar.innerHTML =
    '<div class="lw-scroll-base" aria-hidden="true"></div>' +
    '<div class="lw-scroll-active" aria-hidden="true"></div>' +
    '<div class="lw-scroll-shimmer" aria-hidden="true"></div>';
  document.body.appendChild(bar);

  let raf = 0;

  function scrollProgress(el) {
    const max = el.scrollHeight - el.clientHeight;
    if (max <= 1) return 0;
    return Math.min(1, Math.max(0, el.scrollTop / max));
  }

  function windowProgress() {
    const doc = document.documentElement;
    const max = doc.scrollHeight - window.innerHeight;
    if (max <= 1) return 0;
    return Math.min(1, Math.max(0, window.scrollY / max));
  }

  function activePageBody() {
    return document.querySelector('.page.active .page-body');
  }

  function currentProgress() {
    const body = activePageBody();
    if (body && body.scrollHeight > body.clientHeight + 1) {
      return scrollProgress(body);
    }
    return windowProgress();
  }

  function render() {
    raf = 0;
    const p = currentProgress();
    const pct = (p * 100).toFixed(2) + '%';
    bar.style.setProperty('--lw-p', pct);
    bar.setAttribute('aria-valuenow', String(Math.round(p * 100)));
  }

  function schedule() {
    if (raf) return;
    raf = requestAnimationFrame(render);
  }

  window.addEventListener('scroll', schedule, { passive: true });
  document.addEventListener('scroll', schedule, { passive: true, capture: true });
  window.addEventListener('resize', schedule, { passive: true });

  document.querySelectorAll('.page-body').forEach(function (el) {
    el.addEventListener('scroll', schedule, { passive: true });
  });

  const pageRoot = document.querySelector('main') || document.body;
  const observer = new MutationObserver(schedule);
  observer.observe(pageRoot, {
    subtree: true,
    attributes: true,
    attributeFilter: ['class'],
    childList: true,
  });

  render();
})();
