/* 光の窓 — 下部スペクトラム・ページ遷移バー（index.html 以外） */
(function () {
  const path = (location.pathname || '').split('/').pop() || 'index.html';
  if (path === '' || path === 'index.html') return;
  if (document.getElementById('lw-nav')) return;

  const PAGES = [
    { key: 'g', label: '科学', href: 'lab_research.html', match: ['lab_research.html'] },
    { key: 'b', label: '技術', href: 'lab_manager.html', match: ['lab_manager.html'] },
    { key: 'c', label: '道具', href: 'ta_rabo_profile.html', match: ['ta_rabo_profile.html', 'works_tools_description.html'] },
    { key: 'y', label: '発見', href: 'lesson_design.html', match: ['lesson_design.html'] },
    { key: 'm', label: '表現', href: 'lab_expression.html', match: ['lab_expression.html'] },
    { key: 'w', label: '疑問力', href: null, soon: true, match: [] },
  ];

  const KEY_COLOR = {
    g: '#2ee66a',
    b: '#5b7fff',
    c: '#00e5e5',
    y: '#ffe066',
    m: '#ff4de8',
    w: '#f5f5f5',
  };

  const css = `
    :root { --lw-nav-h: 2.65rem; }
    body.has-lw-nav {
      padding-bottom: calc(var(--lw-nav-h) + 0.35rem);
    }
    #lw-nav {
      position: fixed;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: 10040;
      display: flex;
      flex-direction: column;
      pointer-events: none;
    }
    #lw-nav .lw-nav-links {
      pointer-events: auto;
      display: flex;
      justify-content: center;
      align-items: center;
      flex-wrap: wrap;
      gap: 0.1rem 0.55rem;
      padding: 0.38rem 0.85rem 0.42rem;
      background: linear-gradient(to top, rgba(0,0,0,.88) 0%, rgba(0,0,0,.52) 72%, transparent 100%);
    }
    #lw-nav a,
    #lw-nav span.lw-nav-soon {
      font-family: 'Space Mono', 'Noto Sans JP', monospace;
      font-size: 0.52rem;
      letter-spacing: 0.12em;
      text-decoration: none;
      color: rgba(255,255,255,.42);
      border-bottom: 1px solid transparent;
      transition: color .18s, border-color .18s, opacity .18s;
      white-space: nowrap;
    }
    #lw-nav a:hover,
    #lw-nav a:focus-visible {
      color: rgba(255,255,255,.88);
      outline: none;
    }
    #lw-nav a.is-current {
      color: var(--lw-c, #fff);
      border-bottom-color: var(--lw-c, #fff);
    }
    #lw-nav span.lw-nav-soon {
      opacity: 0.32;
      cursor: default;
    }
    #lw-nav .lw-nav-sep {
      width: 1px;
      height: 0.65rem;
      background: rgba(255,255,255,.12);
      flex-shrink: 0;
    }
    #lw-nav .lw-nav-spectrum {
      height: 2px;
      flex-shrink: 0;
      background: linear-gradient(
        90deg,
        #9333ea 0%,
        #6366f1 11%,
        #2563eb 22%,
        #06b6d4 34%,
        #22c55e 46%,
        #a3e635 54%,
        #eab308 64%,
        #f97316 76%,
        #ec4899 88%,
        #9333ea 100%
      );
      box-shadow:
        0 0 10px rgba(147, 51, 234, 0.28),
        0 0 18px rgba(6, 182, 212, 0.18),
        0 0 24px rgba(234, 179, 8, 0.12);
      opacity: 0.92;
    }
    #lw-nav .lw-nav-marker {
      position: absolute;
      bottom: 0;
      height: 2px;
      width: 2rem;
      max-width: 12vw;
      border-radius: 1px;
      background: rgba(255,255,255,.95);
      box-shadow: 0 0 8px rgba(255,255,255,.55);
      transform: translateX(-50%);
      transition: left .25s ease, width .25s ease, opacity .25s ease;
      pointer-events: none;
    }
    @media (max-width: 520px) {
      :root { --lw-nav-h: 3.1rem; }
      #lw-nav .lw-nav-links { gap: 0.08rem 0.4rem; padding-inline: 0.55rem; }
      #lw-nav a, #lw-nav span.lw-nav-soon { font-size: 0.48rem; }
    }
    @media (prefers-reduced-motion: reduce) {
      #lw-nav a, #lw-nav .lw-nav-marker { transition: none; }
    }
  `;

  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
  document.body.classList.add('has-lw-nav');

  const nav = document.createElement('nav');
  nav.id = 'lw-nav';
  nav.setAttribute('aria-label', '光の窓 — ページ移動');

  const links = document.createElement('div');
  links.className = 'lw-nav-links';

  let currentIndex = -1;
  PAGES.forEach((page, i) => {
    const isCurrent = page.match.some((m) => path === m || path.endsWith('/' + m));
    if (isCurrent) currentIndex = i;

    if (page.soon || !page.href) {
      const span = document.createElement('span');
      span.className = 'lw-nav-soon';
      span.textContent = page.label;
      span.title = '準備中';
      links.appendChild(span);
    } else {
      const a = document.createElement('a');
      a.href = page.href;
      a.textContent = page.label;
      a.style.setProperty('--lw-c', KEY_COLOR[page.key] || '#fff');
      if (isCurrent) {
        a.classList.add('is-current');
        a.setAttribute('aria-current', 'page');
      }
      links.appendChild(a);
    }

    if (i < PAGES.length - 1) {
      const sep = document.createElement('span');
      sep.className = 'lw-nav-sep';
      sep.setAttribute('aria-hidden', 'true');
      links.appendChild(sep);
    }
  });

  const spectrum = document.createElement('div');
  spectrum.className = 'lw-nav-spectrum';
  spectrum.setAttribute('aria-hidden', 'true');

  const marker = document.createElement('div');
  marker.className = 'lw-nav-marker';
  marker.setAttribute('aria-hidden', 'true');
  marker.style.opacity = currentIndex >= 0 ? '1' : '0';

  nav.appendChild(links);
  nav.appendChild(marker);
  nav.appendChild(spectrum);
  document.body.appendChild(nav);

  function placeMarker() {
    if (currentIndex < 0) return;
    const currentEl = links.querySelector('a.is-current');
    if (!currentEl) return;
    const navRect = nav.getBoundingClientRect();
    const elRect = currentEl.getBoundingClientRect();
    const center = elRect.left + elRect.width / 2 - navRect.left;
    marker.style.left = `${center}px`;
    marker.style.width = `${Math.min(elRect.width + 6, 48)}px`;
  }

  placeMarker();
  window.addEventListener('resize', placeMarker, { passive: true });
})();
