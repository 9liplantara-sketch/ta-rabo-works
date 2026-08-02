/* 光の窓 — 右下ミニ RGB ボタン（サブページはポータルへ / ポータルは現在地） */
(function () {
  if (document.getElementById('lw-fab')) return;

  const path = (location.pathname || '').split('/').pop() || 'index.html';
  const isPortal = path === '' || path === 'index.html';

  const css = `
    #lw-fab {
      position: fixed;
      right: 1rem;
      bottom: calc(1rem + var(--lw-nav-h, 0px));
      z-index: 10050;
      width: 52px;
      height: 52px;
      border-radius: 50%;
      display: grid;
      place-items: center;
      text-decoration: none;
      background: rgba(0,0,0,.55);
      border: 1px solid rgba(255,255,255,.14);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      transition: transform .28s ease, opacity .28s ease, border-color .2s ease, background .2s ease;
    }
    body:not(.lw-chrome-hidden) #lw-fab:hover,
    body:not(.lw-chrome-hidden) #lw-fab:focus-visible {
      transform: scale(1.06);
      border-color: rgba(255,255,255,.35);
      background: rgba(0,0,0,.72);
      outline: none;
    }
    #lw-fab-venn {
      position: relative;
      width: 34px;
      height: 34px;
    }
    #lw-fab-venn i {
      position: absolute;
      width: 20px;
      height: 20px;
      border-radius: 50%;
      mix-blend-mode: screen;
      opacity: .95;
    }
    #lw-fab-venn .r { left: 7px; top: 2px; background: #ff2a2a; }
    #lw-fab-venn .g { left: 2px; top: 12px; background: #2aff2a; }
    #lw-fab-venn .b { right: 2px; top: 12px; background: #2a5aff; }
    #lw-fab.is-portal-here {
      border-color: rgba(255,255,255,.42);
      background: rgba(255,255,255,.08);
      box-shadow: 0 0 0 2px rgba(255,255,255,.1);
      cursor: default;
    }
    #lw-fab.is-portal-here:hover,
    #lw-fab.is-portal-here:focus-visible {
      cursor: pointer;
    }
    @media (prefers-reduced-motion: reduce) {
      #lw-fab { transition: none; }
      body:not(.lw-chrome-hidden) #lw-fab:hover,
      body:not(.lw-chrome-hidden) #lw-fab:focus-visible { transform: none; }
    }
  `;

  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  const a = document.createElement('a');
  a.id = 'lw-fab';
  if (isPortal) {
    a.href = '#';
    a.className = 'is-portal-here';
    a.title = '光の窓（現在のページ）';
    a.setAttribute('aria-label', '光の窓 — ページ先頭へ');
    a.setAttribute('aria-current', 'page');
    a.addEventListener('click', function (e) {
      e.preventDefault();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  } else {
    a.href = 'index.html';
    a.title = '光の窓';
    a.setAttribute('aria-label', '光の窓へ戻る');
  }
  a.innerHTML = '<span id="lw-fab-venn" aria-hidden="true"><i class="r"></i><i class="g"></i><i class="b"></i></span>';
  document.body.appendChild(a);
})();
