import { AppLogger } from "../../logger/logger.js";
import {
  ActionResponseSchema,
  PostTypeEventSchema,
  toNullableId,
  type NapcatGatewayActionResponse,
  type NapcatGatewayPostTypeEventPayload,
} from "./shared.js";

type NapcatGatewayInboundMessageRouterOptions = {
  resolveActionResponse: (response: NapcatGatewayActionResponse) => void;
  handlePostTypeEvent: (eventPayload: NapcatGatewayPostTypeEventPayload) => Promise<void>;
};

const logger = new AppLogger({ source: "service.napcat-gateway" });

export class NapcatGatewayInboundMessageRouter {
  private readonly resolveActionResponse: (response: NapcatGatewayActionResponse) => void;
  private readonly handlePostTypeEvent: (
    eventPayload: NapcatGatewayPostTypeEventPayload,
  ) => Promise<void>;

  public constructor({
    resolveActionResponse,
    handlePostTypeEvent,
  }: NapcatGatewayInboundMessageRouterOptions) {
    this.resolveActionResponse = resolveActionResponse;
    this.handlePostTypeEvent = handlePostTypeEvent;
  }

  public handle(rawData: unknown): void {
    if (typeof rawData !== "string") {
      logger.warn("NapCat websocket message is not a string", {
        event: "napcat.gateway.message_non_string",
      });
      return;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(rawData);
    } catch (error) {
      logger.errorWithCause("Failed to parse NapCat websocket message", error, {
        event: "napcat.gateway.message_parse_failed",
      });
      return;
    }

    const actionResponse = ActionResponseSchema.safeParse(payload);
    if (actionResponse.success) {
      this.resolveActionResponse(actionResponse.data);
      return;
    }

    const postTypeEvent = PostTypeEventSchema.safeParse(payload);
    if (!postTypeEvent.success) {
      return;
    }

    void this.handlePostTypeEvent(postTypeEvent.data).catch(error => {
      logger.errorWithCause("Failed to handle NapCat post type event", error, {
        event: "napcat.gateway.post_type_event_handle_failed",
        postType: postTypeEvent.data.post_type,
        messageType: postTypeEvent.data.message_type,
        groupId: toNullableId(postTypeEvent.data.group_id),
        userId: toNullableId(postTypeEvent.data.user_id),
      });
    });
  }
}
