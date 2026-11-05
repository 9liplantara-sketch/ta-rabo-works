/* 図やアイコンに重なると、それが指している文だけを白く光らせる。
   研究室方針の data-policy-target と同じ見え方。 */
(function () {
  const style = document.createElement('style');
  style.textContent = `
    html .glow-mark.is-hot,
    html .glow-mark.is-hot strong,
    html .policy-mark.is-hot,
    html .policy-mark.is-hot strong {
      color: #fff !important;
      background: none !important;
      text-shadow:
        0 0 8px rgba(255,255,255,.88),
        0 0 16px rgba(255,255,255,.74),
        0 0 28px rgba(255,255,255,.5) !important;
    }
    html .glow-mark.is-hot,
    html .policy-mark.is-hot {
      filter:
        drop-shadow(0 0 8px rgba(255,255,255,.81))
        drop-shadow(0 0 20px rgba(255,255,255,.56));
    }
    [data-glow], [data-policy-target],
    .card, .domain, .block, .tool-card, .tool-index-link, .work-card, .key-card, .pillar, .tl-row,
    .young-stage, .loop-node, .where-dot, .section-title .iconify, .cmy-key > span { cursor: pointer; }
    .card.is-source, .domain.is-source, .block.is-source, .tool-card.is-source,
    .tool-index-link.is-source, .work-card.is-source, .key-card.is-source, .pillar.is-source,
    .tl-row.is-source, .young-stage.is-source {
      box-shadow:
        0 0 12px rgba(255,255,255,.32),
        0 0 28px rgba(255,255,255,.14);
    }
  `;
  document.head.appendChild(style);

  let pinned = null;
  let suppressLeave = false;
  let active = null;

  function ids(attr) {
    return (attr || '').split(/\s+/).filter(Boolean)
      .map((id) => document.getElementById(id))
      .filter(Boolean);
  }

  function sourceFrom(node) {
    if (!node || !node.closest) return null;
    const explicit = node.closest('[data-glow], [data-policy-target]');
    if (explicit) return explicit;
    const key = node.closest('.cmy-key > span');
    if (key) return key;
    const card = node.closest('.card, .domain, .block, .tool-card, .tool-index-link, .work-card, .key-card, .pillar, .tl-row, .young-stage');
    if (card) return card;
    return node.closest('.loop-node, .where-dot, .section-title .iconify');
  }

  function marksFor(source) {
    const attr = source.getAttribute('data-glow') || source.getAttribute('data-policy-target');
    if (attr) return ids(attr);
    if (source.matches('.tl-row')) return [source.querySelector('.tl-note')].filter(Boolean);
    if (source.matches('.card, .domain, .block')) return [source.querySelector(':scope > p')].filter(Boolean);
    if (source.matches('.tool-card')) return [source.querySelector('.tool-card-body')].filter(Boolean);
    if (source.matches('.pillar, .key-card')) return [source.querySelector(':scope > p')].filter(Boolean);
    if (source.matches('.young-stage')) return [source.querySelector('p')].filter(Boolean);
    if (source.matches('.loop-node')) {
      const loop = source.closest('.think-loop');
      return loop ? [...loop.querySelectorAll(':scope > p, .loop-return')] : [];
    }
    if (source.matches('.work-card')) return [source.querySelector('.work-body > p:not(.combo)')].filter(Boolean);
    if (source.matches('.tool-index-link')) return [source.querySelector('.tool-index-desc')].filter(Boolean);
    if (source.matches('.where-dot')) return [source.closest('.where-sign')?.querySelector('.where-sign-note')].filter(Boolean);
    if (source.closest('.section-title')) {
      const section = source.closest('section');
      const lead = section?.querySelector(':scope > .section-lead, :scope > .lead, :scope > .section-sub');
      return lead ? [lead] : [];
    }
    if (source.matches('.cmy-key > span')) {
      const keys = [...document.querySelectorAll('.cmy-key > span')];
      const mark = document.getElementById(['glow-step-tools', 'glow-step-express', 'glow-step-discover'][keys.indexOf(source)]);
      return mark ? [mark] : [];
    }
    return [];
  }

  function clearHot() {
    document.querySelectorAll('.is-hot').forEach((m) => m.classList.remove('is-hot'));
    document.querySelectorAll('.is-source').forEach((m) => m.classList.remove('is-source'));
    active = null;
  }

  function scrollParent(node) {
    let el = node.parentElement;
    while (el && el !== document.body) {
      const s = getComputedStyle(el);
      if (/(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight + 8) return el;
      el = el.parentElement;
    }
    return null;
  }

  function visible(node) {
    const scroller = scrollParent(node);
    const nb = node.getBoundingClientRect();
    if (nb.width === 0 && nb.height === 0) return false;
    if (!scroller) return nb.bottom > 8 && nb.top < window.innerHeight - 8;
    const sb = scroller.getBoundingClientRect();
    return nb.bottom > sb.top + 6 && nb.top < sb.bottom - 6;
  }

  function show(source) {
    const marks = marksFor(source);
    if (!marks.length) return;
    clearHot();
    active = source;
    source.classList.add('is-source');
    marks.forEach((m) => m.classList.add('is-hot', 'glow-mark'));
    const onScreen = marks.some((m) => source.contains(m) || visible(m));
    const outside = marks.find((m) => !source.contains(m) && !visible(m));
    if (outside && !onScreen) {
      suppressLeave = true;
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      outside.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
      window.setTimeout(() => { suppressLeave = false; }, reduce ? 0 : 480);
    }
  }

  document.addEventListener('pointerover', (e) => {
    if (e.pointerType === 'touch') return;
    const source = sourceFrom(e.target);
    if (!source || source === active || source === pinned) return;
    pinned = null;
    show(source);
  });

  document.addEventListener('pointerout', (e) => {
    if (!active || suppressLeave || pinned) return;
    const source = sourceFrom(e.target);
    if (source !== active) return;
    const next = sourceFrom(e.relatedTarget);
    if (next === active || next) return;
    clearHot();
  });

  document.addEventListener('focusin', (e) => {
    const source = sourceFrom(e.target);
    if (!source) return;
    pinned = null;
    show(source);
  });

  document.addEventListener('focusout', (e) => {
    if (suppressLeave || pinned) return;
    const source = sourceFrom(e.target);
    if (source && source === active) clearHot();
  });

  document.addEventListener('click', (e) => {
    if (e.pointerType !== 'touch' && !window.matchMedia('(hover: none)').matches) return;
    const source = sourceFrom(e.target);
    if (!source) return;
    if (pinned === source) {
      pinned = null;
      clearHot();
      return;
    }
    pinned = source;
    show(source);
  });

  document.addEventListener('pointerdown', (e) => {
    if (!pinned || pinned.contains(e.target)) return;
    pinned = null;
    clearHot();
  });
})();
