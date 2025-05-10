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

app.event("reaction_added", async ({ event, client, ack }) => {
  await ack(); // 👈 これを最初に！

  // スタンプが :memo: じゃなければ無視
  if (event.reaction !== "要約_bylemon") return;

  app.logger.info("reaction_added", event)
  const { item, user } = event;

  const threadTs = item.ts;
  const channel = item.channel;

  app.logger.info(`:要約_bylemon: が ${threadTs} に押されたにゃ！`);

  const messages = await getRawMessages(channel, threadTs);
  if (!messages || messages.length === 0) return;

  const chatMessages = messages.map((msg) => ({
    role: "user",
    content: msg.text || "",
  }));

  const completion = await openai.chat.completions.create({
    model: "gpt-4.1-nano",
    messages: [
      {
        role: "system",
        content: "以下のSlackスレッドの内容を簡潔に要約してにゃ！",
      },
      ...chatMessages,
    ],
    temperature: 0.3,
  });

  const summary = completion.choices[0].message.content;

  await client.chat.postMessage({
    channel: channel,
    thread_ts: threadTs,
    text: `📝 要約にゃ：\n${summary}`,
  });
});

app.command("/summary", async ({ command, ack, respond }) => {
  app.logger.info("command!")
  await ack(); // 3秒以内に即レス

  try {
    const channel = command.channel_id;

    // 最近のメッセージを取得（直近50件）
    const history = await app.client.conversations.history({
      channel,
      limit: 50,
    });

    if (!history || !history.messages || history.messages.length === 0) {
      await respond({
        text: "最近のメッセージが見つからなかったにゃ…😿",
        response_type: "ephemeral",
      });
      return;
    }

    // 有効なメッセージだけ抽出（botじゃない、textがある）
    const userMessages = history.messages
      .filter((msg) => msg.subtype !== "bot_message" && msg.text)
      .map((msg) => ({
        role: "user",
        content: msg.text,
      }))
      .reverse(); // 古い順に並び替え（会話の流れを保つ）

    if (userMessages.length === 0) {
      await respond({
        text: "人間の投稿がなかったにゃ…😢",
        response_type: "ephemeral",
      });
      return;
    }

    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-nano",
      messages: [
        {
          role: "system",
          content: "以下はSlackチャンネルの最近の会話です。内容を簡潔に要約してにゃ！",
        },
        ...userMessages,
      ],
      temperature: 0,
    });
    const summary = completion.choices[0].message.content;

    await app.client.chat.postMessage({
      channel: channel,
      text: `📝 最近の会話の要約にゃ：\n${summary}`,
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
  app.logger.info("app_mention!", event)
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
