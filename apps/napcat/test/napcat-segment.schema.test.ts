import { describe, expect, it } from "vitest";
import { NapcatSendGroupMessageRequestSchema } from "@kagami/napcat-api/message";
import { NapcatReceiveMessageSegmentSchema } from "../src/domain/napcat-segment.js";

// 出站 segment 没有 zod 校验层（出站只用 NapcatSendMessageSegment 联合**类型**在编译期约束，
// 运行时不 parse），原先那组 NapcatSend*SegmentSchema 只被本文件自测、无任何生产消费者，
// 已随死代码清理删除。出站实际产出的形状由 outgoing-image-segments / shared 的解析测试覆盖。
describe("NapCat segment schemas", () => {
  it("should validate all supported receive segments", () => {
    const samples: unknown[] = [
      { type: "text", data: { text: "hello" } },
      { type: "at", data: { qq: "all", name: "全体成员" } },
      {
        type: "image",
        data: {
          summary: "image",
          file: "abc",
          sub_type: 0,
          url: "https://example.com/a.png",
          file_size: "1024",
        },
      },
      {
        type: "image",
        data: {
          summary: "emoji",
          file: "abc",
          sub_type: "market",
          url: "https://example.com/a.png",
          key: "k",
          emoji_id: "1",
          emoji_package_id: 2,
        },
      },
      { type: "file", data: { file: "a", file_id: "f1", file_size: "1024" } },
      { type: "poke", data: { type: "1", id: "2" } },
      { type: "dice", data: { result: "3" } },
      { type: "rps", data: { result: "2" } },
      {
        type: "face",
        data: {
          id: "66",
          raw: { faceIndex: 1 },
          resultId: null,
          chainCount: null,
        },
      },
      {
        type: "face",
        data: {
          id: "319",
          raw: {
            faceIndex: 319,
            faceText: "/比心",
            faceType: 2,
            packId: null,
            msgType: null,
            imageType: null,
            chainCount: null,
          },
          resultId: null,
          chainCount: null,
        },
      },
      { type: "reply", data: { id: "9988" } },
      { type: "video", data: { file: "v", url: "https://example.com/v.mp4", file_size: "1" } },
      { type: "record", data: { file: "r", file_size: "1" } },
      {
        type: "forward",
        data: {
          id: "1001",
          content: [{ type: "text", data: { text: "nested" } }],
        },
      },
      { type: "json", data: { data: '{"ok":true}' } },
      { type: "markdown", data: { content: "**bold**" } },
    ];

    for (const sample of samples) {
      expect(NapcatReceiveMessageSegmentSchema.safeParse(sample).success).toBe(true);
    }
  });

  it("should allow group send plain text message only", () => {
    const parsed = NapcatSendGroupMessageRequestSchema.safeParse({
      groupId: "112233",
      message: "hello",
    });

    expect(parsed.success).toBe(true);
  });

  it("should reject non string group send message", () => {
    const parsed = NapcatSendGroupMessageRequestSchema.safeParse({
      groupId: "112233",
      message: [
        {
          type: "text",
          data: {
            text: "hello",
          },
        },
      ],
    });

    expect(parsed.success).toBe(false);
  });

  it("should reject legacy groupId in group send payload", () => {
    const parsed = NapcatSendGroupMessageRequestSchema.safeParse({
      message: "hello",
    });

    expect(parsed.success).toBe(false);
  });
});
