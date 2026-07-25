/* Where is TARA? — 光の窓台面右側の4色サイン（純 RGB + 黒） */
(function () {
  const APP_URL = 'https://where-sign-controller-fd3plxg8uywtu85xnk2zag.streamlit.app';
  const API_BASE = String(window.TA_RABO_API_BASE || 'https://ta-rabo-works.vercel.app').replace(/\/$/, '');
  const ORDER = [
    { key: 'CAMPUS', label: '通勤・構内', color: '#00ff00' },
    { key: 'LAB', label: '研究室', color: '#0000ff' },
    { key: 'ELSE', label: 'その他', color: '#000000' },
    { key: 'HOME', label: '自宅', color: '#ff0000' },
  ];

  function ensureStyles() {
    if (document.getElementById('where-sign-style')) return;
    const style = document.createElement('style');
    style.id = 'where-sign-style';
    style.textContent = `
      .where-sign {
        position: absolute;
        right: max(.75rem, 2vw);
        top: 50%;
        transform: translateY(-50%);
        z-index: 20;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: .55rem;
        pointer-events: auto;
      }
      .where-sign-cap {
        font-family: 'Space Mono', monospace;
        font-size: .48rem;
        letter-spacing: .22em;
        color: #5a5a5a;
        text-transform: uppercase;
        writing-mode: horizontal-tb;
      }
      .where-sign-dots {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: .45rem;
      }
      .where-dot {
        width: 14px;
        height: 14px;
        border-radius: 50%;
        display: block;
        text-decoration: none;
        border: 1px solid rgba(255,255,255,.22);
        box-sizing: border-box;
        transition: transform .18s ease, box-shadow .18s ease, border-color .18s ease;
      }
      .where-dot[data-key="ELSE"] {
        background: #000;
        border-color: rgba(255,255,255,.4);
      }
      .where-dot.is-active {
        transform: scale(1.35);
        border-color: rgba(255,255,255,.85);
        box-shadow: 0 0 0 2px rgba(255,255,255,.2);
      }
      .where-dot:hover,
      .where-dot:focus-visible {
        transform: scale(1.45);
        outline: none;
        border-color: #fff;
      }
      .where-sign-status {
        font-family: 'Noto Sans JP', sans-serif;
        font-size: .58rem;
        color: #9a9a9a;
        letter-spacing: .06em;
        writing-mode: vertical-rl;
        text-orientation: mixed;
        max-height: 6.5rem;
        line-height: 1.2;
      }
      @media (max-width: 560px) {
        .where-sign {
          right: .55rem;
          gap: .4rem;
        }
        .where-dot { width: 12px; height: 12px; }
        .where-sign-status { display: none; }
      }
      @media (prefers-reduced-motion: reduce) {
        .where-dot { transition: none; }
      }
    `;
    document.head.appendChild(style);
  }

  function mount() {
    if (document.getElementById('where-sign')) return document.getElementById('where-sign');
    const host = document.querySelector('.stage') || document.body;
    if (getComputedStyle(host).position === 'static') {
      host.style.position = 'relative';
    }
    ensureStyles();

    const aside = document.createElement('aside');
    aside.id = 'where-sign';
    aside.className = 'where-sign';
    aside.setAttribute('aria-label', 'Where is TARA? カラーサイン');

    const cap = document.createElement('div');
    cap.className = 'where-sign-cap';
    cap.textContent = 'Where';

    const dots = document.createElement('div');
    dots.className = 'where-sign-dots';

    ORDER.forEach((s) => {
      const a = document.createElement('a');
      a.className = 'where-dot';
      a.dataset.key = s.key;
      a.href = APP_URL;
      a.target = '_blank';
      a.rel = 'noopener';
      a.title = `${s.label} — Where is TARA?`;
      a.setAttribute('aria-label', `${s.label}（Where is TARA? を開く）`);
      a.style.background = s.color;
      dots.appendChild(a);
    });

    const status = document.createElement('div');
    status.className = 'where-sign-status';
    status.id = 'where-sign-status';
    status.textContent = '—';

    aside.appendChild(cap);
    aside.appendChild(dots);
    aside.appendChild(status);
    host.appendChild(aside);
    return aside;
  }

  function setActive(value, label) {
    document.querySelectorAll('.where-dot').forEach((el) => {
      el.classList.toggle('is-active', el.dataset.key === value);
    });
    const status = document.getElementById('where-sign-status');
    if (status) status.textContent = label || '—';
  }

  async function sync() {
    try {
      const res = await fetch(`${API_BASE}/api/where`, { credentials: 'omit' });
      const data = await res.json().catch(() => ({}));
      if (data && data.value) {
        setActive(data.value, data.label || data.value);
      }
    } catch (_) {
      /* オフライン時は静的表示のまま */
    }
  }

  mount();
  sync();
  setInterval(sync, 5 * 60 * 1000);
})();
