#!/usr/bin/env bash
# LINE Webhook 用: Vercel 環境変数設定 + 本番デプロイ
# 使い方（ターミナルで）:
#   cd /Users/ta_rabo/Projects/ta-rabo-works
#   bash scripts/setup-line-webhook.sh
#
# 事前に Apps Script の /exec URL を用意してください。

set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v vercel >/dev/null 2>&1; then
  if [ -x .tools/node/bin/vercel ]; then
    export PATH="$(pwd)/.tools/node/bin:$PATH"
  elif command -v npx >/dev/null 2>&1; then
    alias vercel='npx vercel'
  else
    echo "vercel CLI がありません。先に次を実行してください:"
    echo "  npm install -g vercel"
    exit 1
  fi
fi

echo "==> Vercel ログイン（ブラウザが開きます）"
vercel login

echo "==> このリポジトリを Vercel プロジェクトにリンク"
vercel link

echo ""
echo "Apps Script の Web アプリ URL（末尾 /exec）を貼り付けて Enter:"
read -r GAS_URL
if [ -z "${GAS_URL}" ]; then
  echo "URL が空です。中止します。"
  exit 1
fi

echo "==> 環境変数 SEMINAR_SCHEDULE_GAS_URL を Production に設定"
printf '%s' "$GAS_URL" | vercel env add SEMINAR_SCHEDULE_GAS_URL production

echo "==> 本番デプロイ"
vercel --prod

echo ""
echo "完了したら確認:"
echo "  curl -i https://ta-rabo-works.vercel.app/api/line-webhook"
echo "期待: HTTP 200 と本文 OK"
echo ""
echo "LINE Developers の Webhook URL:"
echo "  https://ta-rabo-works.vercel.app/api/line-webhook"
