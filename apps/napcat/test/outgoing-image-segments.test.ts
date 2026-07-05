import { describe, expect, it } from "vitest";
import { buildOutgoingImageSegments } from "../src/application/napcat-gateway/shared.js";

describe("buildOutgoingImageSegments", () => {
  it("builds a single image segment with the base64 file ref", () => {
    const segments = buildOutgoingImageSegments({ fileRef: "base64://AAA" });
    expect(segments).toEqual([{ type: "image", data: { file: "base64://AAA" } }]);
  });

  it("includes summary when provided", () => {
    const segments = buildOutgoingImageSegments({ fileRef: "base64://AAA", summary: "图说" });
    expect(segments).toEqual([{ type: "image", data: { file: "base64://AAA", summary: "图说" } }]);
  });

  it("prepends a reply segment (OneBot requires reply first)", () => {
    const segments = buildOutgoingImageSegments({ fileRef: "base64://AAA", replyToMessageId: 42 });
    expect(segments).toEqual([
      { type: "reply", data: { id: "42" } },
      { type: "image", data: { file: "base64://AAA" } },
    ]);
  });
});
