/* 光の窓 — 下部スペクトラム・スクロール進行バー（index.html 以外） */
(function () {
  const path = (location.pathname || '').split('/').pop() || 'index.html';
  if (path === '' || path === 'index.html') return;

  const BAR_H = 4;
  const EMPH_H = 5;
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
    /* 移動するプログレス帯：なだらかなグラデーションで明るく */
    #lw-scroll .lw-scroll-progress {
      position: absolute;
      left: 0;
      right: 0;
      bottom: 0;
      height: ${BAR_H}px;
      background: ${SPECTRUM};
      -webkit-mask-image: ${bandMask};
      mask-image: ${bandMask};
      animation: lw-progress-glow 2.6s ease-in-out infinite;
    }
    /* 強調点：+1px・散乱した色光 */
    #lw-scroll .lw-scroll-emphasis {
      position: absolute;
      left: var(--lw-p, 0%);
      bottom: 0;
      width: 52px;
      height: ${EMPH_H}px;
      transform: translateX(-50%);
      background:
        radial-gradient(ellipse 85% 200% at 50% 115%, rgba(147,51,234,.55) 0%, transparent 68%),
        radial-gradient(ellipse 55% 160% at 28% 105%, rgba(37,99,235,.42) 0%, transparent 62%),
        radial-gradient(ellipse 55% 160% at 72% 105%, rgba(6,182,212,.38) 0%, transparent 62%),
        radial-gradient(ellipse 45% 130% at 50% 90%, rgba(234,179,8,.28) 0%, transparent 58%),
        radial-gradient(ellipse 35% 110% at 40% 80%, rgba(236,72,153,.22) 0%, transparent 55%);
      filter: blur(0.6px);
      animation: lw-emphasis-scatter 2.6s ease-in-out infinite;
      pointer-events: none;
    }
    @keyframes lw-progress-glow {
      0%, 100% {
        opacity: 0.82;
        filter: brightness(0.92) saturate(1.12);
      }
      50% {
        opacity: 1;
        filter: brightness(1.22) saturate(1.28);
      }
    }
    @keyframes lw-emphasis-scatter {
      0%, 100% {
        opacity: 0.5;
        filter: blur(0.5px) brightness(0.95);
        transform: translateX(-50%) scaleX(0.92);
      }
      50% {
        opacity: 0.92;
        filter: blur(0.9px) brightness(1.15);
        transform: translateX(-50%) scaleX(1.06);
      }
    }
    @media (prefers-reduced-motion: reduce) {
      #lw-scroll .lw-scroll-progress {
        animation: none;
        opacity: 1;
        filter: brightness(1.14) saturate(1.2);
      }
      #lw-scroll .lw-scroll-emphasis {
        animation: none;
        opacity: 0.75;
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
    '<div class="lw-scroll-emphasis" aria-hidden="true"></div>';
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
