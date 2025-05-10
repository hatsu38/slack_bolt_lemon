const { App } = require("@slack/bolt");
const { OpenAI } = require("openai");

// ボットトークンと Signing Secret を使ってアプリを初期化します
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  appToken: process.env.SLACK_APP_TOKEN // 追加
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

app.message('おはよう', async ({ message, client }) => {
  app.logger.info("おはよう!");
  
  if (message.subtype === 'bot_message') {
    return;
  }

  await client.chat.postMessage({
    channel: message.channel,
    thread_ts: message.ts, // ← これでスレッドに返信！
    text: `おはよう <@${message.user}>！ 今日も1日頑張ろう❤️‍🔥`,
  });
});

app.event("reaction_added", async ({ event, client }) => {
  if (event.reaction !== "要約_bylemon") return;

  const { item } = event;
  const threadTs = item.ts;
  const channel = item.channel;

  app.logger.info(`[reaction_added] スタンプ受信 @${threadTs}`);

  // まずは返事をする
  await client.chat.postMessage({
    channel: channel,
    thread_ts: threadTs,
    text: ":要約_bylemon: の スタンプありがとう！要約するにゃ〜", // スタンプに反応してメッセージを送る
  });

  app.logger.info(`[reaction_added] スレッドメッセージ取得中...`);
  const messages = await getRawMessages(channel, threadTs);
  if (!messages || messages.length === 0) {
    app.logger.warn(`[reaction_added] スレッドメッセージが空！`);
    return;
  }
  app.logger.info(`[reaction_added] メッセージ数: ${messages.length}`);

  const chatMessages = messages.map((msg) => ({
    role: "user",
    content: msg.text || "",
  }));

  app.logger.info(`[reaction_added] ChatGPTへ要約リクエスト送信...`);
  const start = Date.now();
  const completion = await openai.chat.completions.create({
    model: "gpt-4.1-nano",
    messages: [
      {
        role: "system",
        content: "以下のSlackスレッドの内容を簡潔に要約してにゃ！このBotの名前は「レモンちゃん」です。緩めの可愛い猫みたいなキャラクターです！",
      },
      ...chatMessages,
    ],
    temperature: 0,
  });
  const duration = Date.now() - start;
  app.logger.info(`[reaction_added] ChatGPT応答完了 (${duration}ms)`);

  const summary = completion.choices[0].message.content;

  app.logger.info(`[reaction_added] 要約投稿中...`);
  await client.chat.postMessage({
    channel: channel,
    thread_ts: threadTs,
    text: `📝 要約にゃ：\n${summary}`,
  });

  app.logger.info(`[reaction_added] 要約完了！`);
});

app.command("/summary", async ({ command, ack, respond }) => {
  app.logger.info("[/summary] コマンド受信");
  await ack();

  try {
    const channel = command.channel_id;

    app.logger.info("[/summary] チャンネル履歴取得中...");
    const history = await app.client.conversations.history({
      channel,
      limit: 50,
    });

    if (!history || !history.messages || history.messages.length === 0) {
      app.logger.warn("[/summary] 履歴なし");
      await respond({ text: "最近のメッセージが見つからなかったにゃ…😿", response_type: "ephemeral" });
      return;
    }

    const userMessages = history.messages
      .filter((msg) => msg.subtype !== "bot_message" && msg.text)
      .map((msg) => ({
        role: "user",
        content: msg.text,
      }))
      .reverse();

    app.logger.info(`[/summary] 対象メッセージ数: ${userMessages.length}`);

    if (userMessages.length === 0) {
      await respond({ text: "人間の投稿がなかったにゃ…😢", response_type: "ephemeral" });
      return;
    }

    app.logger.info("[/summary] ChatGPT要約リクエスト送信...");
    const start = Date.now();
    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-nano",
      messages: [
        {
          role: "system",
          content: "以下はSlackチャンネルの最近の会話です。内容を簡潔に要約してにゃ！このBotの名前は「レモンちゃん」です。緩めの可愛い猫みたいなキャラクターです！",
        },
        ...userMessages,
      ],
      temperature: 0,
    });
    const duration = Date.now() - start;
    app.logger.info(`[/summary] ChatGPT応答完了 (${duration}ms)`);

    const summary = completion.choices[0].message.content;

    await app.client.chat.postMessage({
      channel: channel,
      text: `📝 最近の会話の要約にゃ：\n${summary}`,
    });
    app.logger.info("[/summary] 要約投稿完了");
  } catch (error) {
    app.logger.error("Error in /summary:", error);
    await respond({ text: "要約中にエラーが起きたにゃ…💥", response_type: "ephemeral" });
  }
});


app.event("app_mention", async ({ event, client }) => {
  const { channel, ts, user } = event;

  app.logger.info(`[app_mention] メンション受信！@${ts} from <@${user}>`);

  if (Math.random() < 0.3) {
    const preResponses = [
      "見てるにゃ！ちょっと待っててにゃ〜",
      "OKにゃ、今考えてるにゃ💭",
      "やっほー、準備中にゃ🐱‍👤",
    ];
    const msg = preResponses[Math.floor(Math.random() * preResponses.length)];

    await client.chat.postMessage({
      channel: event.channel,
      thread_ts: event.ts,
      text: msg,
    });
  }

  app.logger.info(`[app_mention] スレッド読み込み中...`);
  const messages = await getRawMessages(channel, ts);
  if (!messages || messages.length === 0) {
    app.logger.warn(`[app_mention] メッセージが見つからなかったにゃ…`);
    return;
  }

  app.logger.info(`[app_mention] メッセージ数: ${messages.length}`);

  const chatMessages = messages.map((msg) => ({
    role: msg.user === user ? "user" : "assistant",
    content: msg.text || "",
  }));

  app.logger.info(`[app_mention] ChatGPTリクエスト送信中...`);
  const start = Date.now();
  const completion = await openai.chat.completions.create({
    model: "gpt-4.1-nano",
    messages: [
      {
        role: "system",
        content: "あなたはSlackで返信する親切なAI「レモンちゃん」です。語尾はにゃをつけて返信しましょう！",
      },
      ...chatMessages,
    ],
    temperature: 0,
  });
  const duration = Date.now() - start;
  app.logger.info(`[app_mention] ChatGPT応答完了 (${duration}ms)`);

  const response = completion.choices[0].message.content;

  app.logger.info(`[app_mention] レスポンス送信中...`);
  await app.client.chat.postMessage({
    channel: channel,
    text: `<@${user}> ${response}`,
    thread_ts: ts,
  });

  app.logger.info(`[app_mention] 完了にゃ！`);
});


// スレッド全体を読み込む関数
const getRawMessages = async (channelId, messageId) => {
  const messageList = [];
  let hasMore = false;
  let cursor = undefined;

  do {
    try {
      const replies = await app.client.conversations.replies({
        channel: channelId,
        ts: messageId,
        cursor: cursor,
      });
      if (!replies || !replies.messages) {
        return null;
      }

      replies.messages.forEach((message) => {
        if (message.text != null) {
          const attachmentsText =
            (message.attachments || [])
              .map((attachment) => attachment.text || attachment.fallback)
              .filter((text) => text != null)
              .map((text) =>
                text
                  .split("\n")
                  .map((line) => `> ${line}`)
                  .join("\n")
              )
              .join("\n") || "";

          messageList.push({
            ...message,
            text: attachmentsText
              ? `${message.text}\n${attachmentsText}`
              : message.text,
          });
        }
      });

      hasMore = replies.has_more || false;
      cursor = (replies.response_metadata || "").next_cursor;
    } catch (error) {
      console.error("Error fetching raw messages:", error);
      return null;
    }
  } while (hasMore);

  return messageList;
};

(async () => {
  // アプリを起動します
  await app.start(process.env.PORT || 3000);

  app.logger.info("⚡️ Bolt app is running!🏃");
})();
