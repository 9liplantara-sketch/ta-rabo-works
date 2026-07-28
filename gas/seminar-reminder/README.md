# 研究会日程 × LINE リマインド（Google Apps Script）

スプレッドシートを正本にして、

1. **毎日 10:00（JST）** に、**2日前** と **前日** の研究会を LINE グループへ通知
2. サイト（`lab_manager.html`）へ JSON を公開し、表示を自動更新

## 1. スプレッドシート

シート名を **`研究会日程`** にし、1行目を次のヘッダーにしてください。

| 日付 | 開始 | 終了 | 場所 | 種別 | 内容 | 提出物 | 準備物 | リマインド | 備考 |
|---|---|---|---|---|---|---|---|---|---|

- `日付`: `2026-08-07` または日付セル
- `開始` / `終了`: `13:00` / `15:00`（空なら 13:00〜15:00）
- `種別`: `lecture` など英キー、または `レクチャー` など日本語ラベル
- `リマインド`: 空または TRUE で通知する。`FALSE` でスキップ

雛形 CSV: [`../../data/seminar-schedule.sheet-template.csv`](../../data/seminar-schedule.sheet-template.csv)

## 2. Apps Script を紐づけ

1. スプレッドシート → **拡張機能 → Apps Script**
2. このフォルダの `Code.gs` / `appsscript.json` を貼り付け
3. **プロジェクトの設定 → スクリプトプロパティ** に追加  
   - `LINE_CHANNEL_ACCESS_TOKEN`  
   - `LINE_GROUP_ID`

## 3. LINE Messaging API

1. [LINE Developers](https://developers.line.biz/) で Messaging API チャネルを作成
2. **チャネルアクセストークン（長期）** を発行してプロパティへ
3. ボットを研究室の LINE グループに招待
4. グループで何か発言し、Webhook または [Get content](https://developers.line.biz/ja/reference/messaging-api/#get-group-summary) 等で **groupId**（`C` から始まる ID）を取得してプロパティへ

groupId の取り方（簡易）:

1. Webhook URL を一時的に用意する（または「応答メッセージ」オフのまま、イベントログを見る）
2. グループにボットを追加したときの Webhook イベント `source.groupId` を控える

## 4. トリガー

Apps Script エディタ → **トリガー** → 追加

- 実行する関数: `sendDailyReminders`
- イベントのソース: 時間主導型
- 日付ベースのタイマー: 毎日
- 時刻: **午前 10時〜11時**（タイムゾーンは `Asia/Tokyo`）

手動確認: 関数 `testPushSample` または `testReminders` を実行

## 5. サイト連携（JSON 公開）

1. デプロイ → **新しいデプロイ** → 種類: **ウェブアプリ**
2. 次のユーザーとして実行: **自分**
3. アクセスできるユーザー: **全員**
4. デプロイ後の URL（`.../exec`）を控える
5. Vercel の環境変数に設定  
   `SEMINAR_SCHEDULE_GAS_URL=<そのURL>`
6. 再デプロイ後、サイトの研究会ページがシート内容を読みます（失敗時は従来の `data/seminar-schedule.js` にフォールバック）

## 通知文の例

**前日 10:00**

```
【研究会リマインド｜前日】
明日はプロトタイピングラボで研究会があります。

日時：2026年8月7日（金）13:00〜15:00
内容：プロトタイピングの進め方／1ヶ月制作の組み立て

提出物：進捗メモ1枚
準備物：試作中の実物
```

**2日前 10:00** も同型（冒頭が「○月○日は〜で研究会があります」）。
