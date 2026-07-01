import { describe, expect, it, vi } from "vitest";
import { AppEntryResetExtension } from "../../src/agent/runtime/root-agent/extensions/app-entry-reset.extension.js";

describe("AppEntryResetExtension", () => {
  it("clears the session's entered-app set on context compaction", () => {
    const clearEnteredApps = vi.fn();
    const extension = new AppEntryResetExtension({ session: { clearEnteredApps } });

    extension.onContextCompacted();

    expect(clearEnteredApps).toHaveBeenCalledTimes(1);
  });
});
