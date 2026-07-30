/* 光の窓 — 下部スペクトラム・スクロール進行バー（index.html 以外） */
(function () {
  const path = (location.pathname || '').split('/').pop() || 'index.html';
  if (path === '' || path === 'index.html') return;

  const BAR_H = 4;
  const PROG_H = 6;
  const EMPH_H = 7;
  const FADE_PX = 22;
  const CORE_PX = 10;

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
      rgba(0,0,0,.25) max(0px, calc(var(--lw-p, 0%) - ${CORE_PX + Math.round(FADE_PX * 0.65)}px)),
      rgba(0,0,0,.65) max(0px, calc(var(--lw-p, 0%) - ${CORE_PX + Math.round(FADE_PX * 0.35)}px)),
      #000 max(0px, calc(var(--lw-p, 0%) - ${CORE_PX}px)),
      #000 min(100%, calc(var(--lw-p, 0%) + ${CORE_PX}px)),
      rgba(0,0,0,.65) min(100%, calc(var(--lw-p, 0%) + ${CORE_PX + Math.round(FADE_PX * 0.35)}px)),
      rgba(0,0,0,.25) min(100%, calc(var(--lw-p, 0%) + ${CORE_PX + Math.round(FADE_PX * 0.65)}px)),
      transparent min(100%, calc(var(--lw-p, 0%) + ${CORE_PX + FADE_PX}px))
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
      overflow: visible;
    }
    /* 完成した虹（常時・約80%） */
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
    /* 移動するプログレス帯：+2px・透き通る輝き */
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
    /* 強調点：+3px・散乱した色光 */
    #lw-scroll .lw-scroll-emphasis {
      position: absolute;
      left: var(--lw-p, 0%);
      bottom: 0;
      width: 56px;
      height: ${EMPH_H}px;
      transform: translateX(-50%);
      background:
        radial-gradient(ellipse 90% 220% at 50% 118%, rgba(147,51,234,.58) 0%, transparent 66%),
        radial-gradient(ellipse 58% 175% at 26% 108%, rgba(37,99,235,.45) 0%, transparent 60%),
        radial-gradient(ellipse 58% 175% at 74% 108%, rgba(6,182,212,.41) 0%, transparent 60%),
        radial-gradient(ellipse 48% 145% at 50% 92%, rgba(234,179,8,.31) 0%, transparent 56%),
        radial-gradient(ellipse 38% 125% at 42% 82%, rgba(236,72,153,.26) 0%, transparent 52%);
      mix-blend-mode: screen;
      filter: blur(0.7px);
      animation: lw-emphasis-scatter 2.6s ease-in-out infinite;
      pointer-events: none;
    }
    /* 透き通ったハイライト */
    #lw-scroll .lw-scroll-lucent {
      position: absolute;
      left: var(--lw-p, 0%);
      bottom: 0;
      width: 48px;
      height: ${PROG_H}px;
      transform: translateX(-50%);
      background: radial-gradient(
        ellipse 95% 240% at 50% 105%,
        rgba(255,255,255,.24) 0%,
        rgba(210,235,255,.12) 32%,
        rgba(255,255,255,.05) 52%,
        transparent 72%
      );
      mix-blend-mode: screen;
      animation: lw-lucent-pulse 2.6s ease-in-out infinite;
      pointer-events: none;
    }
    @keyframes lw-progress-glow {
      0%, 100% {
        opacity: 0.85;
        filter: brightness(0.97) saturate(1.15) contrast(1.01);
      }
      50% {
        opacity: 1;
        filter: brightness(1.28) saturate(1.32) contrast(1.02);
      }
    }
    @keyframes lw-emphasis-scatter {
      0%, 100% {
        opacity: 0.54;
        filter: blur(0.55px) brightness(1.0);
        transform: translateX(-50%) scaleX(0.94) scaleY(0.96);
      }
      50% {
        opacity: 0.96;
        filter: blur(0.95px) brightness(1.21);
        transform: translateX(-50%) scaleX(1.08) scaleY(1.06);
      }
    }
    @keyframes lw-lucent-pulse {
      0%, 100% { opacity: 0.36; }
      50% { opacity: 0.68; }
    }
    @media (prefers-reduced-motion: reduce) {
      #lw-scroll .lw-scroll-progress {
        animation: none;
        opacity: 1;
        filter: brightness(1.2) saturate(1.24);
      }
      #lw-scroll .lw-scroll-emphasis {
        animation: none;
        opacity: 0.78;
      }
      #lw-scroll .lw-scroll-lucent {
        animation: none;
        opacity: 0.52;
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
  bar.setAttribute('aria-label', 'ページの読了位置');
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
