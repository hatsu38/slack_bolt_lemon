const { App, LogLevel, Assistant } = require('@slack/bolt');
const { config } = require('dotenv');
const { InferenceClient } = require('@huggingface/inference');

config();

/** アプリの初期化 */
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true,
  logLevel: LogLevel.DEBUG,
});

// HuggingFace のクライアント設定
const hfClient = new InferenceClient(process.env.HUGGINGFACE_API_KEY);

const DEFAULT_SYSTEM_CONTENT = `あなたはSlackワークスペース内のアシスタントです。
ユーザーは何かを書く手助けや、特定のテーマについて考えるための補助を求めてきます。
その問いに対してプロフェッショナルな回答を行ってください。
Markdown形式のテキストを含む場合は、Slack互換の形式に変換してください。
<@USER_ID> や <#CHANNEL_ID> など、Slack独自の構文はそのまま保持してください。`;

const assistant = new Assistant({
  // 任意でスレッドコンテキストを保存・取得するストアを定義できる（今回は使ってない）
  // threadContextStore: {
  //   get: async ({ context, client, payload }) => {},
  //   save: async ({ context, client, payload }) => {},
  // },

  /**
   * アシスタントのスレッドが開始されたときに呼ばれるイベント。
   * ユーザーがアシスタントを開いた瞬間にトリガーされる。
   */
  threadStarted: async ({ event, logger, say, setSuggestedPrompts, saveThreadContext }) => {
    const { context } = event.assistant_thread;

    try {
      // 初回メッセージ送信（開発・デモ用途）
      await say('こんにちは！何をお手伝いしましょうか？');

      // スレッドのコンテキストを保存
      await saveThreadContext();

      const prompts = [
        {
          title: '提案プロンプトの例',
          message:
            'ユーザーがこのプロンプトをクリックすると、' +
            'その内容がそのままLLMに送信されます。\n\n' +
            'アシスタント、ユーザーに提案できる便利なプロンプトを作ってください。',
        },
      ];

      // チャンネル内で開かれた場合は、チャンネル要約プロンプトも追加
      if (context.channel_id) {
        prompts.push({
          title: 'チャンネルを要約して',
          message: 'アシスタント、このチャンネル内のやり取りを要約してください！',
        });
      }

      // 最大4つまでのプロンプトを表示できる
      await setSuggestedPrompts({ prompts, title: 'おすすめのプロンプトはこちら：' });
    } catch (e) {
      logger.error(e);
    }
  },

  /**
   * ユーザーがチャンネルを切り替えたときに呼ばれるイベント。
   */
  threadContextChanged: async ({ logger, saveThreadContext }) => {
    try {
      await saveThreadContext();
    } catch (e) {
      logger.error(e);
    }
  },

  /**
   * ユーザーが送ったメッセージ（サブタイプなし）がアシスタントに届いたときの処理。
   */
  userMessage: async ({ client, logger, message, getThreadContext, say, setTitle, setStatus }) => {
    const { channel, thread_ts } = message;

    try {
      // スレッドのタイトルを設定（初期メッセージを使う）
      await setTitle(message.text);

      // 「入力中」のステータス表示を出す
      await setStatus('入力中…');

      /** シナリオ1：チャンネルの要約プロンプトに対応する場合 */
      if (message.text === 'アシスタント、このチャンネル内のやり取りを要約してください！') {
        const threadContext = await getThreadContext();
        let channelHistory;

        try {
          channelHistory = await client.conversations.history({
            channel: threadContext.channel_id,
            limit: 50,
          });
        } catch (e) {
          // チャンネルにアシスタントが未参加だった場合は参加してから再試行
          if (e.data.error === 'not_in_channel') {
            await client.conversations.join({ channel: threadContext.channel_id });
            channelHistory = await client.conversations.history({
              channel: threadContext.channel_id,
              limit: 50,
            });
          } else {
            logger.error(e);
          }
        }

        // LLMに送るためのプロンプトを生成
        let llmPrompt = `Slackチャンネル <#${threadContext.channel_id}> の以下のメッセージを要約してください：`;
        for (const m of channelHistory.messages.reverse()) {
          if (m.user) llmPrompt += `\n<@${m.user}> の発言: ${m.text}`;
        }

        const messages = [
          { role: 'system', content: DEFAULT_SYSTEM_CONTENT },
          { role: 'user', content: llmPrompt },
        ];

        // HuggingFace に問い合わせ
        const llmResponse = await hfClient.chatCompletion({
          model: 'Qwen/QwQ-32B',
          messages,
          max_tokens: 2000,
        });

        // ユーザーへ返答
        await say({ text: llmResponse.choices[0].message.content });

        return;
      }

      /** シナリオ2：通常のユーザー発言をLLMに渡す場合 */

      // スレッド内のやりとりを取得
      const thread = await client.conversations.replies({
        channel,
        ts: thread_ts,
        oldest: thread_ts,
      });

      // メッセージを LLM 用に整形
      const userMessage = { role: 'user', content: message.text };
      const threadHistory = thread.messages.map((m) => {
        const role = m.bot_id ? 'assistant' : 'user';
        return { role, content: m.text };
      });

      const messages = [{ role: 'system', content: DEFAULT_SYSTEM_CONTENT }, ...threadHistory, userMessage];

      // HuggingFace に送信して返答を得る
      const llmResponse = await hfClient.chatCompletion({
        model: 'Qwen/QwQ-32B',
        messages,
        max_tokens: 2000,
      });

      // 結果をユーザーに送信
      await say({ text: llmResponse.choices[0].message.content });
    } catch (e) {
      logger.error(e);

      // エラー時のフォールバックメッセージ
      await say({ text: '申し訳ありません、処理中にエラーが発生しました！' });
    }
  },
});

// アプリにアシスタントを登録
app.assistant(assistant);

/** Boltアプリの起動処理 */
(async () => {
  try {
    await app.start();
    app.logger.info('⚡️ Boltアプリが起動しました！');
  } catch (error) {
    app.logger.error('アプリの起動に失敗しました', error);
  }
})();
