import { describe, expect, it, vi } from "vitest";
import { TrySendMessageTool } from "../../src/tools/index.js";

describe("try_send_message tool", () => {
  it("should finish the round and return the internal send result", async () => {
    const trySendMessageService = {
      trySend: vi.fn().mockResolvedValue({
        sent: true,
        message: "来咯",
        messageId: 9527,
      }),
    };
    const tool = new TrySendMessageTool({
      trySendMessageService: trySendMessageService as never,
    });

    const result = await tool.execute(
      {},
      {
        systemPrompt: "system-prompt",
        messages: [{ role: "user", content: "hello" }],
      },
    );

    expect(tool.name).toBe("try_send_message");
    expect(trySendMessageService.trySend).toHaveBeenCalledWith({
      systemPrompt: "system-prompt",
      contextMessages: [{ role: "user", content: "hello" }],
    });
    expect(result.signal).toBe("finish_round");
    expect(result.content).toBe(
      JSON.stringify({
        sent: true,
        message: "来咯",
        messageId: 9527,
      }),
    );
  });

  it("should return sent=false and finish the round when snapshot is missing", async () => {
    const trySendMessageService = {
      trySend: vi.fn(),
    };
    const tool = new TrySendMessageTool({
      trySendMessageService: trySendMessageService as never,
    });

    const result = await tool.execute({}, {});

    expect(trySendMessageService.trySend).not.toHaveBeenCalled();
    expect(result).toEqual({
      content: JSON.stringify({
        sent: false,
      }),
      signal: "finish_round",
    });
  });
});
