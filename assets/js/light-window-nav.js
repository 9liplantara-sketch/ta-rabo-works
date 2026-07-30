/* 光の窓 — 下部スペクトラム・スクロール進行バー（index.html 以外） */
(function () {
  const path = (location.pathname || '').split('/').pop() || 'index.html';
  if (path === '' || path === 'index.html') return;
  if (document.getElementById('lw-scroll')) return;

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
    :root { --lw-nav-h: 3px; }
    body.has-lw-scroll { padding-bottom: 0; }
    #lw-scroll {
      position: fixed;
      left: 0;
      right: 0;
      bottom: 0;
      height: 3px;
      z-index: 10040;
      pointer-events: none;
      overflow: visible;
    }
    #lw-scroll .lw-scroll-dim {
      position: absolute;
      inset: 0;
      background: ${SPECTRUM};
      opacity: 0.22;
    }
    #lw-scroll .lw-scroll-lit {
      position: absolute;
      inset: 0;
      background: ${SPECTRUM};
      opacity: 1;
      -webkit-mask-image: radial-gradient(
        ellipse 140px 28px at var(--lw-x, 0%) 50%,
        #000 0%,
        transparent 72%
      );
      mask-image: radial-gradient(
        ellipse 140px 28px at var(--lw-x, 0%) 50%,
        #000 0%,
        transparent 72%
      );
    }
    #lw-scroll .lw-scroll-beam {
      position: absolute;
      top: 50%;
      left: var(--lw-x, 0%);
      width: 5px;
      height: 5px;
      transform: translate(-50%, -50%);
      border-radius: 50%;
      background: #fff;
      box-shadow:
        0 0 4px rgba(255,255,255,.95),
        0 0 10px rgba(255,255,255,.7),
        0 0 18px rgba(147,51,234,.75),
        0 0 28px rgba(37,99,235,.55),
        0 0 36px rgba(6,182,212,.45),
        0 0 44px rgba(234,179,8,.35);
    }
    #lw-scroll .lw-scroll-halo {
      position: absolute;
      top: 50%;
      left: var(--lw-x, 0%);
      width: 72px;
      height: 14px;
      transform: translate(-50%, -50%);
      border-radius: 50%;
      background: radial-gradient(
        ellipse,
        rgba(255,255,255,.55) 0%,
        rgba(147,51,234,.25) 35%,
        rgba(6,182,212,.12) 55%,
        transparent 72%
      );
      filter: blur(1px);
      mix-blend-mode: screen;
    }
    @media (prefers-reduced-motion: reduce) {
      #lw-scroll .lw-scroll-beam,
      #lw-scroll .lw-scroll-lit,
      #lw-scroll .lw-scroll-halo {
        transition: none;
      }
    }
  `;

  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
  document.body.classList.add('has-lw-scroll');

  const bar = document.createElement('div');
  bar.id = 'lw-scroll';
  bar.setAttribute('role', 'progressbar');
  bar.setAttribute('aria-label', 'ページの読了位置');
  bar.setAttribute('aria-valuemin', '0');
  bar.setAttribute('aria-valuemax', '100');
  bar.setAttribute('aria-valuenow', '0');
  bar.innerHTML =
    '<div class="lw-scroll-dim" aria-hidden="true"></div>' +
    '<div class="lw-scroll-lit" aria-hidden="true"></div>' +
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
    bar.style.setProperty('--lw-x', pct);
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
