export type NapcatGroupMessageEvent = {
  type: "napcat_group_message";
  groupId: string;
  userId: string;
  nickname: string;
  rawMessage: string;
  messageId: number | null;
  time: number | null;
};

export type Event = NapcatGroupMessageEvent;

export function formatEventToUserMessage(event: Event): string | null {
  switch (event.type) {
    case "napcat_group_message":
      return [
        "<message>",
        `${event.nickname} (${event.userId}):`,
        event.rawMessage,
        "</message>",
      ].join("\n");
  }
}
