import { z } from "zod";
import { BizError } from "./biz-error.js";

export type HttpErrorResponse = {
  statusCode: number;
  body: {
    message: string;
  };
};

export function toHttpErrorResponse(error: unknown): HttpErrorResponse {
  if (error instanceof z.ZodError) {
    return {
      statusCode: 400,
      body: {
        message: "请求参数不合法",
      },
    };
  }

  if (error instanceof BizError) {
    return {
      statusCode: error.statusCode,
      body: {
        message: error.message,
      },
    };
  }

  return {
    statusCode: 500,
    body: {
      message: "服务器内部错误",
    },
  };
}
