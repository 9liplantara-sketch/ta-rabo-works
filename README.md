# ta_rabo — Works & Tools

田羅義史（ta_rabo）のポートフォリオ図解・研究室支援ツール集です。  
すべて **静的 HTML** で動作し、サーバー不要でブラウザだけで使えます。

🌐 **公開URL（ルート）**: https://9liplantara-sketch.github.io/ta-rabo-works/

### ローカルで短い `file://` URL（Mac）

フォルダ名に日本語が含まれると、ブラウザのアドレスバーが `%E8%87%AA...` のように長くなります。  
デスクトップに **`tarabo`** というシンボリックリンクを置いてある場合は、次のように短く開けます。

- ポータル: `file:///Users/ta_rabo/Desktop/tarabo/index.html`

リンクの実体は従来どおり `自己紹介とスキル` フォルダです（中身は同一）。リンクが無い場合はターミナルで次を実行してください。

```bash
ln -s "/Users/ta_rabo/Desktop/自己紹介とスキル" "/Users/ta_rabo/Desktop/tarabo"
```

### 主要ページへの直リンク（誰でも閲覧可）

| ページ | URL |
|---|---|
| ポータルトップ | https://9liplantara-sketch.github.io/ta-rabo-works/ |
| ポータルトップ（index.html） | https://9liplantara-sketch.github.io/ta-rabo-works/index.html |
| 自己紹介図解 | https://9liplantara-sketch.github.io/ta-rabo-works/ta_rabo_profile.html |
| 研究室マネージャー | https://9liplantara-sketch.github.io/ta-rabo-works/lab_manager.html |
| 授業デザイン図解 | https://9liplantara-sketch.github.io/ta-rabo-works/lesson_design.html |
| 各ツール説明（独立ドキュメント・他ページへ非リンク） | https://9liplantara-sketch.github.io/ta-rabo-works/works_tools_description.html |
| スキル図解（シルエット＋アイコン） | https://9liplantara-sketch.github.io/ta-rabo-works/skills_diagram.html |

---

## コンテンツ一覧

| ファイル | 説明 |
|---|---|
| [`index.html`](index.html) | ポータルトップ |
| [`ta_rabo_profile.html`](ta_rabo_profile.html) | 自己紹介インタラクティブ図解 |
| [`lab_manager.html`](lab_manager.html) | 研究室マネージャー（素材ガイド・カレンダー・学生進捗・日報） |
| [`lesson_design.html`](lesson_design.html) | 授業デザインフレームワーク |
| [`works_tools_description.html`](works_tools_description.html) | 各ツールの説明のみ（独立ページ・他 HTML へリンクなし） |
| [`skills_diagram.html`](skills_diagram.html) | スキル・ツールの図解（シルエット SVG ＋ Iconify） |

---

## 研究室マネージャーの機能

- **素材ガイド** — 陶芸・漆・金属・木材・屋内・隣族など各素材の技法と手順を図説で管理
- **カレンダー** — 3人（教員＋学生2名）の空き日を色別入力し、全員が空いた日を自動で研究会候補日に設定。長期タスクのドラッグ入力にも対応
- **学生進捗** — マイルストーンのチェックリスト＋研究ノート（テキスト・画像）
- **日報** — 日次の活動記録と次回課題の管理
- **ホーム** — 各セクションのダイジェストと期日が近いタスクのアラートを一覧表示

> データは **localStorage** に保存されます。ブラウザをまたいで共有はできませんが、同じブラウザ上では常に保持されます。

---

## Cursor スキル（AI エージェント向け）

このリポジトリには Cursor IDE 用の **Agent Skill** が含まれています。  
プロフィール図解の再生成・更新に必要な設計仕様を SSoT（Single Source of Truth）として管理しています。

### スキルの場所

```
.cursor/skills/profile-diagram/
├── SKILL.md                    ← スキル定義（エントリポイント）
└── references/
    ├── design-tokens.md        ← フォント・カラーパレット
    ├── activity-map.md         ← Activity Map のノードデータ・実装仕様
    └── html-snippets.md        ← セクション別 HTML テンプレート
```

### スキルのインストール方法

```bash
# プロジェクト固有のスキルとして使う場合はそのまま clone するだけで有効
git clone https://github.com/ta-rabo/works.git

# 全プロジェクトで使えるグローバルスキルにする場合
cp -r .cursor/skills/profile-diagram ~/.cursor/skills/
```

Cursor の設定で「Skills」タブに `profile-diagram` が表示されれば有効です。

---

## ローカルで開く

```bash
git clone https://github.com/9liplantara-sketch/ta-rabo-works.git
cd ta-rabo-works
open index.html   # macOS
# または任意のブラウザで index.html をダブルクリック
```

---

## 技術仕様

- **フレームワーク**: Vanilla HTML / CSS / JavaScript（依存ライブラリなし）
- **アイコン**: [Iconify](https://iconify.design/) + Phosphor Icons（CDN）
- **フォント**: Google Fonts（Noto Sans JP / Space Mono）
- **データ永続化**: localStorage

---

© 2025 田羅義史 (ta_rabo) — [t-a-labo.com](https://www.t-a-labo.com)
