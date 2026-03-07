export type NapcatGroupMessageEvent = {
  type: "napcat_group_message";
  groupId: string;
  userId: string | null;
  rawMessage: string;
  messageId: number | null;
  time: number | null;
};

export type Event = NapcatGroupMessageEvent;

export function formatEventToUserMessage(event: Event): string | null {
  switch (event.type) {
    case "napcat_group_message":
      return [
        "[NAPCAT_GROUP_MESSAGE]",
        `group_id=${event.groupId}`,
        `user_id=${event.userId ?? "unknown"}`,
        `message_id=${event.messageId ?? "unknown"}`,
        `time=${event.time ?? "unknown"}`,
        `raw_message=${event.rawMessage}`,
      ].join("\n");
  }
}
