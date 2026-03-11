import { describe, expect, it } from "vitest";
import { z } from "zod";
import { BizError } from "../../src/errors/biz-error.js";
import { toHttpErrorResponse } from "../../src/errors/http-error.js";

describe("toHttpErrorResponse", () => {
  it("should map ZodError to 400 response", () => {
    const result = z.string().safeParse(123);
    if (result.success) {
      throw new Error("expected ZodError");
    }

    expect(toHttpErrorResponse(result.error)).toEqual({
      statusCode: 400,
      body: {
        message: "请求参数不合法",
      },
    });
  });

  it("should map BizError to its own status and message", () => {
    expect(
      toHttpErrorResponse(
        new BizError({
          message: "NapCat 请求超时",
        }),
      ),
    ).toEqual({
      statusCode: 500,
      body: {
        message: "NapCat 请求超时",
      },
    });
  });

  it("should map unknown error to generic 500 response", () => {
    expect(toHttpErrorResponse(new Error("boom"))).toEqual({
      statusCode: 500,
      body: {
        message: "服务器内部错误",
      },
    });
  });
});
