/**
 * Preview API 接続設定の例。
 * 使い方:
 *   cp assets/js/ta-rabo-preview-config.example.js assets/js/ta-rabo-preview-config.js
 * その後、ALLOWLIST と API_BASE を自分の Preview デプロイ URL（完全一致・末尾スラッシュなし）に書き換え。
 *
 * - 任意の *.vercel.app ワイルドカードは不可
 * - 本番 lab_manager.html はこのファイルを読まない
 * - MODE=preview のまま個人 URL をコミットしないこと
 */
(function (g) {
  g.TA_RABO_API_MODE = 'preview';
  g.TA_RABO_PREVIEW_API_ALLOWLIST = [
    'https://ta-rabo-works-git-cursor-daily-report-media-preview-REPLACE.vercel.app',
  ];
  g.TA_RABO_API_BASE = g.TA_RABO_PREVIEW_API_ALLOWLIST[0];
})(window);
