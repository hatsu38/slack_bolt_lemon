import { App } from "@slack/bolt";
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true,
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

app.event("app_mention", async ({ event, client }) => {
    // スレッド全体を読み込む
    const messages = await getRawMessages(event.channel, event.ts);
  
    const chatMessages = messages.map((msg) => ({
      role: msg.user === event.user ? "user" : "assistant",
      content: msg.text ?? "",
    }));

    // ChatGPT へ投げる！
    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-nano", // or "gpt-3.5-turbo"
      messages: [
        { role: "system", content: "あなたはSlackで返信する親切なAIです。" },
        ...chatMessages,
      ],
      temperature: 0.7,
    });


    // いろんな処理を経て...
    const response = // 生成AIのレスポンス

    // スレッドに返信する
    await app.client.chat.postMessage({
        channel: event.channel,
        text: `<@${event.user}> ${response}`,
        thread_ts: event.ts,
    });
});



export type Message = {
  user?: string;
  text?: string;
};

// スレッド全体を読み込む
export const getRawMessages = async (
  channelId: string,
  messageId: string,
): Promise<Message[] | null> => {
  const messageList: Message[] = [];
  let hasMore = false;
  let cursor = undefined;
  do {
    try {
      const replies = await app.client.conversations.replies({
        channel: channelId,
        ts: messageId,
        cursor: cursor,
      });
      if (replies == null) {
        return null;
      }
      if (replies.messages != null) {
        replies.messages.forEach((message) => {
          if (message.text != null) {
            const attachmentsText =
              message.attachments
                ?.map((attachment) => attachment.text ?? attachment.fallback)
                .filter((text) => text != null)
                .map((text) =>
                  text
                    .split("\n")
                    .map((line) => `> ${line}`)
                    .join("\n"),
                )
                .join("\n") ?? "";

            messageList.push({
              ...message,
              text: attachmentsText
                ? `${message.text}\n${attachmentsText}`
                : message.text,
            });
          }
        });
      }
      hasMore = replies.has_more ?? false;
      cursor = replies.response_metadata?.next_cursor;
    } catch (error) {
      console.error("Error fetching raw messages:", error);
      return null;
    }
  } while (hasMore);

  return messageList;
};

app.event("reaction_added", async ({ event, client }) => {
  // 処理
});