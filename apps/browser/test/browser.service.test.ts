import { describe, expect, it, vi } from "vitest";
import type { BrowserContext } from "playwright-core";
import { initTestLoggerRuntime } from "./helpers/logger.js";

initTestLoggerRuntime();

// cloakbrowser 的 launchPersistentContext 返回一个由测试注入的假 context。
const hoisted = vi.hoisted(() => ({ context: null as unknown as BrowserContext }));
vi.mock("cloakbrowser", () => ({
  launchPersistentContext: vi.fn(async () => hoisted.context),
  ensureBinary: vi.fn(async () => undefined),
}));

const { BrowserService } = await import("../src/application/browser.service.js");

type FakeLocator = {
  click: ReturnType<typeof vi.fn>;
  fill: ReturnType<typeof vi.fn>;
  press: ReturnType<typeof vi.fn>;
  waitFor: ReturnType<typeof vi.fn>;
  first: () => FakeLocator;
};

function makeLocator(): FakeLocator {
  const loc: FakeLocator = {
    click: vi.fn(async () => undefined),
    fill: vi.fn(async () => undefined),
    press: vi.fn(async () => undefined),
    waitFor: vi.fn(async () => undefined),
    first: () => loc,
  };
  return loc;
}

type FakePage = {
  handlers: Record<string, () => void>;
  state: { lastLocator: FakeLocator };
  closeSelf: () => void;
  isClosed: () => boolean;
  url: () => string;
};

function makeFakePage(url: string): FakePage {
  const handlers: Record<string, () => void> = {};
  let closed = false;
  const state: { lastLocator: FakeLocator } = { lastLocator: makeLocator() };
  const page = {
    setDefaultTimeout: vi.fn(),
    setDefaultNavigationTimeout: vi.fn(),
    on: vi.fn((event: string, cb: () => void) => {
      handlers[event] = cb;
    }),
    isClosed: () => closed,
    url: () => url,
    title: vi.fn(async () => "标题"),
    goto: vi.fn(async () => null),
    ariaSnapshot: vi.fn(async () => '- button "登录" [ref=e3] [box=1,2,3,4]'),
    locator: vi.fn((_selector: string) => {
      state.lastLocator = makeLocator();
      return state.lastLocator;
    }),
    getByText: vi.fn(() => makeLocator()),
    keyboard: { press: vi.fn(async () => undefined) },
    waitForTimeout: vi.fn(async () => undefined),
    screenshot: vi.fn(async () => Buffer.from("img")),
    evaluate: vi.fn(async () => false),
  };
  return Object.assign(page, {
    handlers,
    state,
    closeSelf: () => {
      closed = true;
      handlers["close"]?.();
    },
  }) as unknown as FakePage & typeof page;
}

function makeFakeContext(initialPages: FakePage[]) {
  const handlers: Record<string, (page: FakePage) => void> = {};
  const pages = [...initialPages];
  return {
    on: vi.fn((event: string, cb: (page: FakePage) => void) => {
      handlers[event] = cb;
    }),
    pages: () => pages,
    newPage: vi.fn(async () => {
      const page = makeFakePage("https://new");
      pages.push(page);
      return page;
    }),
    close: vi.fn(async () => undefined),
    emitPage: (page: FakePage) => {
      pages.push(page);
      handlers["page"]?.(page);
    },
  };
}

function makeService() {
  return new BrowserService({
    config: { headless: true, userDataDir: "/tmp/test-profile" },
  });
}

describe("BrowserService", () => {
  it("拒绝来自旧 observe 的 ref（STALE_REF）", async () => {
    const page = makeFakePage("https://x");
    hoisted.context = makeFakeContext([page]) as unknown as BrowserContext;
    const service = makeService();

    await service.observe(); // epoch -> 1
    // 当前 epoch 的 ref 可用
    await expect(service.click("1:e3")).resolves.toEqual({ url: "https://x" });
    // 旧 epoch 的 ref 被拒
    await expect(service.click("2:e3")).rejects.toMatchObject({ code: "STALE_REF" });
  });

  it("type 把文本填进 fill 层", async () => {
    const page = makeFakePage("https://login");
    hoisted.context = makeFakeContext([page]) as unknown as BrowserContext;
    const service = makeService();

    await service.observe(); // epoch -> 1
    const result = await service.type("1:e3", { text: "hello" }, false);

    expect(page.state.lastLocator.fill).toHaveBeenCalledWith("hello", expect.anything());
    expect(result).toEqual({ url: "https://login" });
  });

  it("活动页跟随 opener 栈：弹窗压栈、关闭弹回 opener", async () => {
    const p0 = makeFakePage("https://p0");
    const context = makeFakeContext([p0]);
    hoisted.context = context as unknown as BrowserContext;
    const service = makeService();

    expect((await service.navigate("https://go")).url).toBe("https://p0");

    const p1 = makeFakePage("https://p1");
    context.emitPage(p1);
    expect((await service.navigate("https://go")).url).toBe("https://p1");

    p1.closeSelf();
    expect((await service.navigate("https://go")).url).toBe("https://p0");
  });
});
