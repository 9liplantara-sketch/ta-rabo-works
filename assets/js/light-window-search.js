/* 光の窳 — 左下のミニ検索バー（静的索引 → ページジャンプ） */
(function () {
  if (document.getElementById('lw-search')) return;

  const INDEX_URL = 'assets/search-index.json';
  let items = [];
  let open = false;

  const css = `
    #lw-search {
      position: fixed;
      left: 1rem;
      bottom: calc(1rem + var(--lw-nav-h, 0px));
      z-index: 10045;
      width: min(52vw, 220px);
      font-family: 'Space Mono', 'Noto Sans JP', sans-serif;
    }
    #lw-search-bar {
      display: flex;
      align-items: center;
      gap: .45rem;
      height: 38px;
      padding: 0 .85rem 0 .72rem;
      background: rgba(0, 0, 0, .55);
      border: 1px solid rgba(255, 255, 255, .14);
      border-radius: 999px;
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      box-shadow: 0 2px 14px rgba(0, 0, 0, .22);
      transition: border-color .2s ease, box-shadow .2s ease, background .2s ease;
    }
    #lw-search-bar:focus-within {
      border-color: rgba(255, 255, 255, .35);
      background: rgba(0, 0, 0, .72);
      box-shadow: 0 3px 18px rgba(0, 0, 0, .28);
    }
    #lw-search-icon {
      flex-shrink: 0;
      width: 13px;
      height: 13px;
      color: rgba(255, 255, 255, .14);
    }
    #lw-search-bar:focus-within #lw-search-icon {
      color: rgba(255, 255, 255, .35);
    }
    #lw-search-input {
      flex: 1;
      min-width: 0;
      border: none;
      background: transparent;
      color: rgba(255, 255, 255, .8);
      font-family: inherit;
      font-size: .62rem;
      letter-spacing: .04em;
    }
    #lw-search-input:focus { outline: none; }
    #lw-search-input::placeholder { color: rgba(255, 255, 255, .2); }
    #lw-search-results {
      display: none;
      position: absolute;
      left: 0;
      right: 0;
      bottom: calc(100% + .5rem);
      list-style: none;
      margin: 0;
      padding: .28rem 0;
      max-height: 200px;
      overflow-y: auto;
      background: rgba(0, 0, 0, .86);
      border: 1px solid rgba(255, 255, 255, .08);
      border-radius: 14px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, .4);
    }
    #lw-search-results.is-open { display: block; }
    #lw-search-results li:first-child a,
    #lw-search-results li:first-child .empty {
      border-top-left-radius: 12px;
      border-top-right-radius: 12px;
    }
    #lw-search-results li:last-child a,
    #lw-search-results li:last-child .empty {
      border-bottom-left-radius: 12px;
      border-bottom-right-radius: 12px;
      border-bottom: none;
    }
    #lw-search-results a,
    #lw-search-results .empty {
      display: block;
      font-size: .62rem;
      line-height: 1.4;
      padding: .45rem .72rem;
      text-decoration: none;
      color: rgba(255, 255, 255, .82);
      border-bottom: 1px solid rgba(255, 255, 255, .05);
    }
    #lw-search-results a:hover,
    #lw-search-results a:focus-visible {
      background: rgba(255, 255, 255, .06);
      outline: none;
    }
    #lw-search-results .meta {
      display: block;
      font-size: .5rem;
      color: rgba(255, 255, 255, .28);
      margin-top: .1rem;
    }
    #lw-search-results .empty {
      color: rgba(255, 255, 255, .32);
      border: none;
    }
    @media (max-width: 520px) {
      #lw-search {
        left: .65rem;
        width: min(44vw, 168px);
      }
      #lw-search-bar {
        height: 34px;
        padding: 0 .72rem 0 .62rem;
      }
      #lw-search-input { font-size: .58rem; }
    }
  `;

  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.id = 'lw-search';
  root.innerHTML =
    '<ul id="lw-search-results" role="listbox" aria-label="検索結果"></ul>' +
    '<form id="lw-search-bar" role="search" autocomplete="off">' +
    '<svg id="lw-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<circle cx="11" cy="11" r="7"></circle><path d="M20 20l-3.5-3.5"></path></svg>' +
    '<input id="lw-search-input" type="search" enterkeyhint="search" placeholder="検索" aria-controls="lw-search-results" aria-autocomplete="list">' +
    '</form>';

  document.body.appendChild(root);

  const form = document.getElementById('lw-search-bar');
  const input = document.getElementById('lw-search-input');
  const results = document.getElementById('lw-search-results');

  function normalize(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  function scoreItem(item, q) {
    if (!q) return 0;
    const hay = normalize(item.title + ' ' + item.keywords + ' ' + item.url);
    if (hay.includes(q)) return hay.indexOf(q) === 0 ? 3 : 2;
    const parts = q.split(' ').filter(Boolean);
    if (parts.every(function (p) { return hay.includes(p); })) return 1;
    return 0;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function setOpen(next) {
    open = next;
    results.classList.toggle('is-open', open && results.innerHTML.length > 0);
  }

  function renderResults(q) {
    const query = normalize(q);
    if (!query) {
      results.innerHTML = '';
      setOpen(false);
      return;
    }

    const matched = items
      .map(function (item) {
        return { item: item, score: scoreItem(item, query) };
      })
      .filter(function (x) { return x.score > 0; })
      .sort(function (a, b) {
        if (b.score !== a.score) return b.score - a.score;
        return a.item.title.localeCompare(b.item.title, 'ja');
      })
      .slice(0, 6);

    if (!matched.length) {
      results.innerHTML = '<li class="empty">該当なし</li>';
      setOpen(true);
      return;
    }

    results.innerHTML = matched
      .map(function (x) {
        const it = x.item;
        return (
          '<li role="option"><a href="' +
          escapeHtml(it.url) +
          '">' +
          escapeHtml(it.title) +
          '<span class="meta">' +
          escapeHtml(it.url) +
          '</span></a></li>'
        );
      })
      .join('');
    setOpen(true);
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    const first = results.querySelector('a');
    if (first) location.href = first.getAttribute('href');
  });

  input.addEventListener('input', function () {
    renderResults(input.value);
  });

  input.addEventListener('focus', function () {
    if (normalize(input.value)) renderResults(input.value);
  });

  input.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      input.value = '';
      setOpen(false);
      input.blur();
    }
  });

  document.addEventListener('click', function (e) {
    if (root.contains(e.target)) return;
    setOpen(false);
  });

  fetch(INDEX_URL)
    .then(function (r) { return r.json(); })
    .then(function (data) {
      items = Array.isArray(data) ? data : [];
    })
    .catch(function () {
      items = [
        { title: '光の窓', url: 'index.html', keywords: 'portal' },
        { title: '研究室マネージャー', url: 'lab_manager.html', keywords: 'lab' },
        { title: '発見の授業設計', url: 'lesson_design.html', keywords: 'discovery' },
      ];
    });
})();
