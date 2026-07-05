import { describe, expect, it } from "vitest";
import {
  renderGroupMessagePlainText,
  renderPrivateMessagePlainText,
} from "../../../../src/agent/apps/qq/qq-message-render.js";

describe("qq-message-render", () => {
  // napcat 拆分后（issue #347），渲染直接用 napcat 侧渲染好的权威 rawMessage，不再 agent 侧重复
  // 渲染段（段→文本渲染 + vision 描述 hydrate 都在 napcat）。
  it("should render qq messages from the napcat-rendered rawMessage", () => {
    expect(
      renderGroupMessagePlainText({
        nickname: "测试昵称",
        userId: "654321",
        rawMessage: "hello structured",
        messageSegments: [
          {
            type: "text",
            data: {
              text: "hello structured",
            },
          },
        ],
      }),
    ).toBe("<qq_message>\n测试昵称 (654321):\nhello structured\n</qq_message>");
  });

  it("should keep qq message wrapper when rendered body is empty", () => {
    expect(
      renderGroupMessagePlainText({
        nickname: "测试昵称",
        userId: "654321",
        rawMessage: "",
        messageSegments: [],
      }),
    ).toBe("<qq_message>\n测试昵称 (654321):\n\n</qq_message>");
  });

  it("should expose message_id as the reply handle when present", () => {
    expect(
      renderGroupMessagePlainText({
        nickname: "测试昵称",
        userId: "654321",
        rawMessage: "hi",
        messageSegments: [{ type: "text", data: { text: "hi" } }],
        messageId: 9988,
      }),
    ).toBe('<qq_message id="9988">\n测试昵称 (654321):\nhi\n</qq_message>');
  });

  it("should prefer remark over nickname for the private chat display name", () => {
    expect(
      renderPrivateMessagePlainText({
        nickname: "网名",
        remark: "备注名",
        userId: "654321",
        rawMessage: "hi",
        messageSegments: [{ type: "text", data: { text: "hi" } }],
      }),
    ).toBe("<qq_message>\n备注名 (654321):\nhi\n</qq_message>");
  });

  it("should fall back to nickname, then userId, when no remark is set", () => {
    expect(
      renderPrivateMessagePlainText({
        nickname: "网名",
        remark: null,
        userId: "654321",
        rawMessage: "hi",
        messageSegments: [{ type: "text", data: { text: "hi" } }],
      }),
    ).toBe("<qq_message>\n网名 (654321):\nhi\n</qq_message>");

    expect(
      renderPrivateMessagePlainText({
        nickname: "  ",
        remark: "  ",
        userId: "654321",
        rawMessage: "hi",
        messageSegments: [{ type: "text", data: { text: "hi" } }],
      }),
    ).toBe("<qq_message>\n654321 (654321):\nhi\n</qq_message>");
  });
});
