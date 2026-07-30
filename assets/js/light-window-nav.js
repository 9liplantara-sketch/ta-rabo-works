/* 光の窓 — 下部スペクトラム・スクロール進行バー */
(function () {
  const path = (location.pathname || '').split('/').pop() || 'index.html';
  const isPortal = path === '' || path === 'index.html';

  const BAR_H = 4;
  const PROG_H = 6;
  const EMPH_H = 7;
  const FADE_PX = 36;
  const CORE_PX = 12;

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

  const fadeStops = [
    [1, 0],
    [0.85, 0.08],
    [0.7, 0.18],
    [0.55, 0.32],
    [0.4, 0.48],
    [0.25, 0.64],
    [0.12, 0.82],
  ];
  const bandMaskLeft = fadeStops
    .map(function (pair) {
      const dist = CORE_PX + Math.round(FADE_PX * pair[0]);
      const alpha = pair[1];
      if (alpha === 0) {
        return `transparent max(0px, calc(var(--lw-p, 0%) - ${dist}px))`;
      }
      return `rgba(0,0,0,${alpha}) max(0px, calc(var(--lw-p, 0%) - ${dist}px))`;
    })
    .join(',\n      ');
  const bandMaskRight = fadeStops
    .slice()
    .reverse()
    .map(function (pair) {
      const dist = CORE_PX + Math.round(FADE_PX * pair[0]);
      const alpha = pair[1];
      if (alpha === 0) {
        return `transparent min(100%, calc(var(--lw-p, 0%) + ${dist}px))`;
      }
      return `rgba(0,0,0,${alpha}) min(100%, calc(var(--lw-p, 0%) + ${dist}px))`;
    })
    .join(',\n      ');
  const bandMask = `
    linear-gradient(
      to right,
      ${bandMaskLeft},
      #000 max(0px, calc(var(--lw-p, 0%) - ${CORE_PX}px)),
      #000 min(100%, calc(var(--lw-p, 0%) + ${CORE_PX}px)),
      ${bandMaskRight}
    )
  `;

  const css = `
    :root { --lw-nav-h: ${EMPH_H}px; }
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
      height: ${EMPH_H}px;
      z-index: 10040;
      pointer-events: none;
      overflow: hidden;
      background: transparent;
      outline: none;
    }
    #lw-scroll .lw-scroll-base {
      position: absolute;
      left: 0;
      right: 0;
      bottom: 0;
      height: ${BAR_H}px;
      background: ${SPECTRUM};
      opacity: 0.8;
      filter: saturate(1.08);
    }
    #lw-scroll .lw-scroll-progress {
      position: absolute;
      left: 0;
      right: 0;
      bottom: 0;
      height: ${PROG_H}px;
      background: ${SPECTRUM};
      mix-blend-mode: screen;
      -webkit-mask-image: ${bandMask};
      mask-image: ${bandMask};
      animation: lw-progress-glow 2.6s ease-in-out infinite;
    }
    #lw-scroll .lw-scroll-emphasis {
      position: absolute;
      left: var(--lw-p, 0%);
      bottom: 0;
      width: 76px;
      height: ${EMPH_H}px;
      transform: translateX(-50%);
      background:
        radial-gradient(ellipse 105% 280% at 50% 122%, rgba(147,51,234,.54) 0%, rgba(147,51,234,.24) 32%, rgba(147,51,234,.08) 52%, transparent 74%),
        radial-gradient(ellipse 72% 210% at 20% 112%, rgba(37,99,235,.42) 0%, rgba(37,99,235,.18) 34%, rgba(37,99,235,.06) 54%, transparent 72%),
        radial-gradient(ellipse 72% 210% at 80% 112%, rgba(6,182,212,.38) 0%, rgba(6,182,212,.16) 34%, rgba(6,182,212,.05) 54%, transparent 72%),
        radial-gradient(ellipse 58% 180% at 50% 96%, rgba(234,179,8,.30) 0%, rgba(234,179,8,.12) 36%, rgba(234,179,8,.04) 56%, transparent 74%),
        radial-gradient(ellipse 48% 150% at 42% 86%, rgba(236,72,153,.26) 0%, rgba(236,72,153,.10) 38%, rgba(236,72,153,.03) 58%, transparent 76%);
      mix-blend-mode: screen;
      filter: blur(0.7px);
      animation: lw-emphasis-scatter 2.6s ease-in-out infinite;
      pointer-events: none;
    }
    #lw-scroll .lw-scroll-lucent {
      position: absolute;
      left: var(--lw-p, 0%);
      bottom: 0;
      width: 72px;
      height: ${PROG_H}px;
      transform: translateX(-50%);
      background: radial-gradient(
        ellipse 120% 300% at 50% 108%,
        rgba(255,255,255,.20) 0%,
        rgba(240,248,255,.13) 12%,
        rgba(210,235,255,.09) 26%,
        rgba(190,225,255,.06) 40%,
        rgba(255,255,255,.03) 54%,
        rgba(255,255,255,.01) 68%,
        transparent 84%
      );
      mix-blend-mode: screen;
      animation: lw-lucent-pulse 2.6s ease-in-out infinite;
      pointer-events: none;
    }
    @keyframes lw-progress-glow {
      0%, 100% {
        opacity: 0.79;
        filter: brightness(0.93) saturate(1.14) contrast(1.01);
      }
      50% {
        opacity: 0.93;
        filter: brightness(1.19) saturate(1.28) contrast(1.02);
      }
    }
    @keyframes lw-emphasis-scatter {
      0%, 100% {
        opacity: 0.50;
        filter: blur(0.55px) brightness(0.96);
        transform: translateX(-50%) scaleX(0.94) scaleY(0.96);
      }
      50% {
        opacity: 0.89;
        filter: blur(0.95px) brightness(1.13);
        transform: translateX(-50%) scaleX(1.08) scaleY(1.06);
      }
    }
    @keyframes lw-lucent-pulse {
      0%, 100% { opacity: 0.33; }
      50% { opacity: 0.63; }
    }
    @media (prefers-reduced-motion: reduce) {
      #lw-scroll .lw-scroll-progress {
        animation: none;
        opacity: 0.93;
        filter: brightness(1.11) saturate(1.20);
      }
      #lw-scroll .lw-scroll-emphasis {
        animation: none;
        opacity: 0.72;
      }
      #lw-scroll .lw-scroll-lucent {
        animation: none;
        opacity: 0.47;
      }
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
  bar.setAttribute('aria-label', isPortal ? '光の窓の読了位置' : 'ページの読了位置');
  bar.setAttribute('aria-valuemin', '0');
  bar.setAttribute('aria-valuemax', '100');
  bar.setAttribute('aria-valuenow', '0');
  bar.innerHTML =
    '<div class="lw-scroll-base" aria-hidden="true"></div>' +
    '<div class="lw-scroll-progress" aria-hidden="true"></div>' +
    '<div class="lw-scroll-emphasis" aria-hidden="true"></div>' +
    '<div class="lw-scroll-lucent" aria-hidden="true"></div>';
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

  function primaryScroller() {
    const body = document.querySelector('.page.active .page-body');
    if (body && body.scrollHeight > body.clientHeight + 1) {
      return body;
    }
    return null;
  }

  function currentProgress() {
    const scroller = primaryScroller();
    if (scroller) return scrollProgress(scroller);
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
