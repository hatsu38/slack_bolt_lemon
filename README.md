# レモンちゃんBot（Slack + OpenAI連携Bot）

SlackのBolt for JavaScriptとOpenAI APIを活用した、猫っぽい性格のSlack Bot「レモンちゃん」です 🐱✨  
メッセージへの反応や、スレッド要約、/summaryコマンドなどを通じてSlack内の会話を要約してくれます！

## 🧠 主な機能

### 🐾 おはようメッセージ
- 誰かが「おはよう」と言うと、自動で元気に挨拶を返してくれます。
- Botが発言したメッセージには反応しません。

### 😺 絵文字リアクションで要約
- スレッド内の投稿に `:要約_bylemon:` のリアクションをつけると、そのスレッド全体を要約してくれます。
- 可愛いキャラ口調で返信してくれます。

### 📝 `/summary` コマンド
- 現在のチャンネルの直近50件の人間の発言を取得し、要約してくれます。
- コマンドは `/summary` と入力するだけでOK。

### 🧵 メンションに返信
- `@レモンちゃん` へのメンションを含むメッセージに反応し、そのスレッド全体を読み込んで文脈を理解し返信してくれます。
- 時々、返事を少し遅らせる可愛い演出もあります。

## 🔧 セットアップ

### 必要な環境変数

| 変数名 | 説明 |
|--------|------|
| `SLACK_BOT_TOKEN` | Slack Botトークン |
| `SLACK_SIGNING_SECRET` | Slackアプリの署名シークレット |
| `SLACK_APP_TOKEN` | Socket Mode用のApp Token（`xapp-`で始まるやつ） |
| `OPENAI_API_KEY` | OpenAI APIキー |
| `PORT` | サーバーを起動するポート（デフォルトは3000） |

### インストール手順

```bash
git clone <このリポジトリのURL>
cd <リポジトリ名>
npm install
cp .env.example .env # 必要に応じて .env を用意
npm start
```

## 🧾 必要なSlackの設定

### OAuthスコープ
- `chat:write`
- `channels:history`
- `commands`
- `reactions:read`
- `reactions:write`
- `app_mentions:read`

### イベントサブスクリプション
Bot Events:
- `message.channels`
- `reaction_added`
- `app_mention`

### Slash Commands
- `/summary`

