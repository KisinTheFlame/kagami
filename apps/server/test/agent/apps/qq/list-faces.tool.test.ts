import { describe, expect, it } from "vitest";
import { ListFacesTool } from "../../../../src/agent/apps/qq/tools/list-faces.tool.js";
import { QQ_FACE_NAMES } from "../../../../src/napcat/application/napcat-gateway/qq-face-names.js";

describe("ListFacesTool", () => {
  it("lists every sendable face name with usage guidance", async () => {
    const tool = new ListFacesTool();

    const result = await tool.execute({}, {});

    const total = Object.keys(QQ_FACE_NAMES).length;
    expect(result.content).toContain(`共 ${total} 个`);
    expect(result.content).toContain("[表情: 名字]");
    // 抽查几个不同年代的表情名都在
    expect(result.content).toContain("比心");
    expect(result.content).toContain("爱心");
    expect(result.content).toContain("doge");
  });
});
