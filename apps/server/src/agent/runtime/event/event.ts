import type { NapcatGroupMessageData } from "../../../napcat/service/napcat-gateway.service.js";

export type NapcatGroupMessageEvent = {
  type: "napcat_group_message";
  data: NapcatGroupMessageData;
};

export type Event = NapcatGroupMessageEvent;

export function formatGroupMessagePlainText(
  input: Pick<NapcatGroupMessageData, "nickname" | "userId" | "rawMessage">,
): string {
  return [`${input.nickname} (${input.userId}):`, input.rawMessage].join("\n");
}
