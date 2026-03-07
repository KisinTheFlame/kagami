export type MessageEvent = {
  type: "message";
  message: string;
};

export type Event = MessageEvent;

export function formatEventToUserMessage(event: Event): string | null {
  switch (event.type) {
    case "message":
      return event.message;
  }
}
