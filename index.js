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

  await client.chat.postMessage({
    channel: message.channel,
    thread_ts: message.ts, // ← これでスレッドに返信！
    text: `おはよう！ <@${message.user}>!`,
  });
});


app.command("/summary", async ({ command, ack, respond }) => {
  await ack(); // 即レスポンス（3秒以内）

  try {
    const thread_ts = command.thread_ts || command.message_ts || command.ts;
    const channel = command.channel_id;

    // スレッドのメッセージ取得
    const messages = await getRawMessages(channel, thread_ts);
    if (!messages) {
      await respond({
        text: "メッセージの取得に失敗したにゃ…😿",
        response_type: "ephemeral",
      });
      return;
    }

    const chatMessages = messages.map((msg) => ({
      role: "user",
      content: msg.text || "",
    }));

    // ChatGPTで要約するにゃ！
    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-nano",
      messages: [
        {
          role: "system",
          content: "以下のスレッドの会話を簡潔に要約してにゃ！",
        },
        ...chatMessages,
      ],
      temperature: 0.3,
    });

    const summary = completion.choices[0].message.content;

    // スレッドに返信！
    await app.client.chat.postMessage({
      channel: channel,
      text: `📝 要約にゃ：\n${summary}`,
      thread_ts: thread_ts,
    });
  } catch (error) {
    console.error("Error in /summary:", error);
    await respond({
      text: "要約中にエラーが起きたにゃ…💥",
      response_type: "ephemeral",
    });
  }
});


app.event("app_mention", async ({ event, client }) => {
  // スレッド全体を読み込む
  app.logger.info("event!", event)
  const messages = await getRawMessages(event.channel, event.ts);
  if (!messages) return;

  const chatMessages = messages.map((msg) => ({
    role: msg.user === event.user ? "user" : "assistant",
    content: msg.text || "",
  }));

  // ChatGPT へ投げる！
  const completion = await openai.chat.completions.create({
    model: "gpt-4.1-nano",
    messages: [
      {
        role: "system",
        content:
          "あなたはSlackで返信する親切なAI「レモンちゃん」です。語尾はにゃをつけて返信しましょう！",
      },
      ...chatMessages,
    ],
    temperature: 0,
  });

  const response = completion.choices[0].message.content;

  // スレッドに返信する
  await app.client.chat.postMessage({
    channel: event.channel,
    text: `<@${event.user}> ${response}`,
    thread_ts: event.ts,
  });
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
