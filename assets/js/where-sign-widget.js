/* Where is TARA? — 現在地は色の強調のみ（詳細地名は出さない） */
(function () {
  const API_BASE = String(window.TA_RABO_API_BASE || 'https://ta-rabo-works.vercel.app').replace(/\/$/, '');

  function setActive(value) {
    document.querySelectorAll('#where-sign .where-dot').forEach((el) => {
      el.classList.toggle('is-active', el.dataset.key === value);
    });
  }

  async function sync() {
    try {
      const res = await fetch(`${API_BASE}/api/where`, { credentials: 'omit' });
      const data = await res.json().catch(() => ({}));
      if (data && data.value) setActive(data.value);
    } catch (_) {
      /* オフライン時は静的表示のまま */
    }
  }

  if (!document.getElementById('where-sign')) return;
  sync();
  setInterval(sync, 5 * 60 * 1000);
})();
