import { describe, expect, it } from "vitest";
import {
  formatMutedNote,
  formatMuteUntil,
  MutedSendError,
} from "../../src/agent/capabilities/messaging/application/muted-send-error.js";

describe("MutedSendError / note", () => {
  it("self 附到期时间（MM-dd HH:mm，本地时区）", () => {
    const until = new Date(2026, 6, 3, 15, 30).getTime(); // 07-03 15:30 本地
    const note = formatMutedNote(new MutedSendError("self", until));
    expect(note).toBe(`你在这个群正被禁言，到 ${formatMuteUntil(until)} 才能说话。`);
    expect(formatMuteUntil(until)).toBe("07-03 15:30");
  });

  it("whole 无到期，独立措辞", () => {
    expect(formatMutedNote(new MutedSendError("whole"))).toBe(
      "这个群正在全员禁言中，解除前发不了消息。",
    );
  });

  it("self 缺到期时间时退化措辞", () => {
    expect(formatMutedNote(new MutedSendError("self"))).toBe(
      "你在这个群正被禁言，暂时发不了消息。",
    );
  });

  it("formatMuteUntil 零填充月/日/时/分", () => {
    const t = new Date(2026, 0, 5, 9, 7).getTime(); // 01-05 09:07
    expect(formatMuteUntil(t)).toBe("01-05 09:07");
  });
});
