/** Exact Preview API; production hosts remain fixed by TaRaboApiConfig. */
(function(g) {
  g.TA_RABO_PREVIEW_API_ALLOWLIST = ['https://ta-rabo-works-git-cursor-daily-report-media-preview-ta-rabo.vercel.app'];
  g.TA_RABO_API_BASE = g.TA_RABO_PREVIEW_API_ALLOWLIST[0];
})(typeof window !== 'undefined' ? window : globalThis);
