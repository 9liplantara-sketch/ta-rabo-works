/* 光の窓 — 下部スペクトラム・スクロール進行バー（index.html 以外） */
(function () {
  const path = (location.pathname || '').split('/').pop() || 'index.html';
  if (path === '' || path === 'index.html') return;

  const BAR_H = 5;

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
      overflow: visible;
    }
    #lw-scroll .lw-scroll-dim {
      position: absolute;
      inset: 0;
      background: ${SPECTRUM};
      opacity: 0.14;
    }
    #lw-scroll .lw-scroll-fill {
      position: absolute;
      left: 0;
      top: 0;
      bottom: 0;
      width: var(--lw-p, 0%);
      background: ${SPECTRUM};
      opacity: 1;
      box-shadow:
        0 0 8px rgba(255,255,255,.35),
        0 0 16px rgba(147,51,234,.45),
        0 0 24px rgba(6,182,212,.28);
    }
    #lw-scroll .lw-scroll-glow {
      position: absolute;
      inset: 0;
      background: ${SPECTRUM};
      opacity: 1;
      -webkit-mask-image: linear-gradient(
        to right,
        #000 0%,
        #000 calc(var(--lw-p, 0%) - 2px),
        transparent calc(var(--lw-p, 0%) + 48px)
      );
      mask-image: linear-gradient(
        to right,
        #000 0%,
        #000 calc(var(--lw-p, 0%) - 2px),
        transparent calc(var(--lw-p, 0%) + 48px)
      );
      filter: brightness(1.35) saturate(1.2);
    }
    #lw-scroll .lw-scroll-beam {
      position: absolute;
      top: 50%;
      left: var(--lw-p, 0%);
      width: 7px;
      height: 7px;
      transform: translate(-50%, -50%);
      border-radius: 50%;
      background: #fff;
      box-shadow:
        0 0 3px rgba(255,255,255,1),
        0 0 8px rgba(255,255,255,.95),
        0 0 16px rgba(255,255,255,.75),
        0 0 24px rgba(147,51,234,.85),
        0 0 36px rgba(37,99,235,.65),
        0 0 48px rgba(6,182,212,.5),
        0 0 60px rgba(234,179,8,.35);
    }
    #lw-scroll .lw-scroll-halo {
      position: absolute;
      top: 50%;
      left: var(--lw-p, 0%);
      width: 96px;
      height: 18px;
      transform: translate(-50%, -50%);
      border-radius: 50%;
      background: radial-gradient(
        ellipse,
        rgba(255,255,255,.75) 0%,
        rgba(255,255,255,.35) 22%,
        rgba(147,51,234,.35) 45%,
        rgba(6,182,212,.18) 62%,
        transparent 78%
      );
      filter: blur(1.5px);
      mix-blend-mode: screen;
    }
    @media (prefers-reduced-motion: reduce) {
      #lw-scroll .lw-scroll-beam,
      #lw-scroll .lw-scroll-halo {
        transition: none;
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
    '<div class="lw-scroll-dim" aria-hidden="true"></div>' +
    '<div class="lw-scroll-fill" aria-hidden="true"></div>' +
    '<div class="lw-scroll-glow" aria-hidden="true"></div>' +
    '<div class="lw-scroll-halo" aria-hidden="true"></div>' +
    '<div class="lw-scroll-beam" aria-hidden="true"></div>';
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
