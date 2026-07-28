import { describe, expect, it } from "vitest";
import {
  OBSERVATORY_ALERT_GROUP_LEAK_MESSAGE,
  isObservatoryAlertGroupVisibleToAgent,
} from "../src/config/config.loader.js";

/**
 * 告警群可见性不变量（issue #602）：observatory 的投递目标群必须同时在
 * server.napcat.blockedGroupIds 里，否则小镜会读到关于自己的告警。根级 superRefine 用这个
 * 谓词把配置错误变成启动失败。
 */
describe("isObservatoryAlertGroupVisibleToAgent", () => {
  it("告警群在黑名单里 → 不可见 → 配置合法", () => {
    expect(
      isObservatoryAlertGroupVisibleToAgent({
        alertGroupId: "111",
        blockedGroupIds: ["999", "111", "222"],
      }),
    ).toBe(false);
  });

  it("告警群不在黑名单里 → 可见 → 配置错误", () => {
    expect(
      isObservatoryAlertGroupVisibleToAgent({
        alertGroupId: "111",
        blockedGroupIds: ["999", "222"],
      }),
    ).toBe(true);
  });

  it("黑名单为空（默认参与所有群）→ 告警群必然可见 → 配置错误", () => {
    expect(
      isObservatoryAlertGroupVisibleToAgent({ alertGroupId: "111", blockedGroupIds: [] }),
    ).toBe(true);
  });

  it("按字符串严格比较：数字形态的群号已由 StringLikeSchema 归一，不做宽松匹配", () => {
    expect(
      isObservatoryAlertGroupVisibleToAgent({
        alertGroupId: "0111",
        blockedGroupIds: ["111"],
      }),
    ).toBe(true);
  });

  it("报错文案指向 blockedGroupIds，让人知道该改哪一处", () => {
    expect(OBSERVATORY_ALERT_GROUP_LEAK_MESSAGE).toContain("blockedGroupIds");
    expect(OBSERVATORY_ALERT_GROUP_LEAK_MESSAGE).toContain("config.secret.yaml");
  });
});
