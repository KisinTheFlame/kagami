import type { NapcatGroupMessageData } from "../../../napcat/service/napcat-gateway.service.js";

export type NapcatGroupMessageEvent = {
  type: "napcat_group_message";
  data: NapcatGroupMessageData;
};

export type Event = NapcatGroupMessageEvent;
