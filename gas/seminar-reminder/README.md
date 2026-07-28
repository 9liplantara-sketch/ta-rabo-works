# 研究会日程 × LINE リマインド（Google Apps Script）

スプレッドシートを正本にして、

1. **Webhook で groupId を自動取得**（手で JSON を読む必要なし）
2. **毎日 10:00（JST）** に、**2日前** と **前日** の研究会を LINE グループへ通知
3. サイト（`lab_manager.html`）へ JSON を公開し、表示を自動更新

手動で入れる秘密情報は **`LINE_CHANNEL_ACCESS_TOKEN` だけ**です。  
`LINE_GROUP_ID` は Bot をグループに入れると自動保存されます。

---

## いまの進め方（groupId 取得まで）

トークンは取れている前提です。

### Step A — Apps Script を貼る

1. 対象スプレッドシートを開く
2. **拡張機能 → Apps Script**
3. このフォルダの `Code.gs` をすべて貼り付けて保存
4. **プロジェクトの設定（歯車）→ スクリプトプロパティ**  
   - プロパティ: `LINE_CHANNEL_ACCESS_TOKEN`  
   - 値: 発行済みの長期チャネルアクセストークン

### Step B — ウェブアプリとしてデプロイ（重要）

1. Apps Script 右上 **デプロイ → 新しいデプロイ**
2. 種類の選択（歯車）→ **ウェブアプリ**
3. 設定:
   - 説明: `seminar-line` など任意
   - 次のユーザーとして実行: **自分**
   - アクセスできるユーザー: **全員**
4. **デプロイ** → 承認（Google アカウント）
5. 表示された URL（末尾が **`/exec`**）をコピー  
   例: `https://script.google.com/macros/s/XXXX/exec`

> コードを直したあとは **デプロイ → デプロイを管理 → 編集 → バージョン「新バージョン」** で再デプロイしてください。古い `/exec` のままだと Webhook が動きません。

### Step C — LINE Developers で Webhook を設定（重要）

Apps Script の `/exec` を直接 Webhook URL にすると、Google のリダイレクトで  
**「Webhookイベントオブジェクト送信時にタイムアウト」** になりやすいです。

そのため Webhook URL は **Vercel の受け口** を使います。

1. [LINE Developers Console](https://developers.line.biz/console/) → 対象チャネル → **Messaging API**
2. **Webhook URL** に次を貼る → **更新**

```
https://ta-rabo-works.vercel.app/api/line-webhook
```

3. **Webhookの利用** を **オン**
4. **Webhook URL 検証** → 成功すること（即 OK が返る）
5. （推奨）応答メッセージ・あいさつメッセージはオフ

あわせて Vercel の環境変数に、Apps Script の `/exec` URL を設定します。

```
SEMINAR_SCHEDULE_GAS_URL=https://script.google.com/macros/s/XXXX/exec
```

（サイトの日程同期と同じ URL です。設定後に Vercel を再デプロイ）

### Step D — Bot を研究室グループへ招待して groupId を取る

1. Messaging API タブの QR / URL から Bot を友だち追加
2. 研究室の LINE **グループ** に Bot をメンバー追加
3. グループ内で「テスト」と一言送る
4. スプレッドシート **`LINE設定`** に `LINE_GROUP_ID`（`C...`）が入れば成功
5. Bot から「設定が完了しました」が届けば送信まで完了

詰まったときは Apps Script で `checkLineSetup` を実行してください。

> コードを直したあとの GAS は **デプロイ → デプロイを管理 → 新バージョン** で再公開が必要です。

---

## スプレッドシート（日程）

シート名を **`研究会日程`** にし、1行目を次のヘッダーにします。

| 日付 | 開始 | 終了 | 場所 | 種別 | 内容 | 提出物 | 準備物 | リマインド | 備考 |
|---|---|---|---|---|---|---|---|---|---|

雛形 CSV: [`../../data/seminar-schedule.sheet-template.csv`](../../data/seminar-schedule.sheet-template.csv)

---

## 毎日 10:00 のトリガー

Apps Script → **トリガー** → 追加

- 関数: `sendDailyReminders`
- 時間主導型 → 日付ベースのタイマー → **毎日**
- 時刻: **午前 10時〜11時**
- タイムゾーン: プロジェクトが `Asia/Tokyo`（`appsscript.json`）

手動確認: `testPushSample`

---

## サイト連携

1. 同じウェブアプリの `/exec` URL を使う
2. Vercel 環境変数  
   `SEMINAR_SCHEDULE_GAS_URL=<そのURL>`
3. 再デプロイ

未設定・取得失敗時は `data/seminar-schedule.js` にフォールバックします。

---

## 通知文の例

```
【研究会リマインド｜前日】
明日はプロトタイピングラボで研究会があります。

日時：2026年8月7日（金）13:00〜15:00
内容：プロトタイピングの進め方／1ヶ月制作の組み立て

提出物：進捗メモ1枚
準備物：試作中の実物
```
