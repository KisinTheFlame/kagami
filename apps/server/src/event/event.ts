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

export function formatGroupMessagePlainText(input: {
  nickname: string;
  userId: string;
  rawMessage: string;
}): string {
  return [`${input.nickname} (${input.userId}):`, input.rawMessage].join("\n");
}
