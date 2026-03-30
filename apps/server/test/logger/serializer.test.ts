import { describe, expect, it } from "vitest";
import { BizError } from "../../src/common/errors/biz-error.js";
import { serializeError } from "../../src/logger/serializer.js";

describe("serializeError", () => {
  it("should include biz error metadata, status code, and nested causes", () => {
    const error = new BizError({
      message: "Claude Code 登录状态不可用",
      meta: {
        provider: "claude-code",
        reason: "AUTH_REFRESH_FAILED",
      },
      statusCode: 502,
      cause: new BizError({
        message: "Claude Code 登录当前不可用",
        meta: {
          reason: "AUTH_REFRESH_UNAVAILABLE",
          status: 401,
        },
        cause: {
          error: "invalid_grant",
        },
      }),
    });

    expect(serializeError(error)).toEqual(
      expect.objectContaining({
        name: "BizError",
        message: "Claude Code 登录状态不可用",
        meta: {
          provider: "claude-code",
          reason: "AUTH_REFRESH_FAILED",
        },
        statusCode: 502,
        cause: expect.objectContaining({
          name: "BizError",
          message: "Claude Code 登录当前不可用",
          meta: {
            reason: "AUTH_REFRESH_UNAVAILABLE",
            status: 401,
          },
          cause: {
            error: "invalid_grant",
          },
        }),
      }),
    );
  });

  it("should keep plain error serialization compatible", () => {
    const error = new Error("boom");
    const serialized = serializeError(error);

    expect(serialized).toEqual(
      expect.objectContaining({
        name: "Error",
        message: "boom",
      }),
    );
    expect(serialized.cause).toBeUndefined();
    expect(serialized.meta).toBeUndefined();
    expect(serialized.statusCode).toBeUndefined();
  });
});
