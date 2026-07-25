/* Where is TARA? — 現在地同期のみ（配置は index.html の #where-sign-slot） */
(function () {
  const API_BASE = String(window.TA_RABO_API_BASE || 'https://ta-rabo-works.vercel.app').replace(/\/$/, '');

  function setActive(value, label) {
    document.querySelectorAll('#where-sign .where-dot').forEach((el) => {
      el.classList.toggle('is-active', el.dataset.key === value);
    });
    const status = document.getElementById('where-sign-status');
    if (status) status.innerHTML = `現在地 · <strong>${label || '—'}</strong>`;
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

  if (!document.getElementById('where-sign')) return;
  sync();
  setInterval(sync, 5 * 60 * 1000);
})();
