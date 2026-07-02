import { BizError } from "@kagami/kernel/errors/biz-error";
import { safeParseJson } from "./safe-parse-json.js";

/**
 * OAuth token 端点 POST 的共享骨架：fetch → 网络错误归一 → 非 2xx 按状态码分
 * 「登录当前不可用」（400/401/403，票据/授权问题）与「登录服务调用失败」（其余，
 * 上游故障）。claude-code 与 codex 两条 OAuth 流此前各写一份逐行同构的实现，
 * 收敛到这里；响应体校验与字段映射仍归各 provider（形状确实不同）。
 */
export async function postOAuthTokenRequest<TParsed>(input: {
  tokenUrl: string;
  /** 错误文案里的 provider 名（"Claude Code" / "Codex"），保持既有措辞逐字不变。 */
  providerLabel: string;
  /** token 端点的 body：claude-code 走 JSON，codex 走 form-urlencoded。 */
  body:
    | { kind: "json"; payload: Record<string, string> }
    | { kind: "form"; params: URLSearchParams };
  timeoutMs: number;
  unavailableReason: string;
}): Promise<{ parsed: TParsed | null; rawText: string }> {
  let response: Response;
  try {
    response = await fetch(input.tokenUrl, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type":
          input.body.kind === "json" ? "application/json" : "application/x-www-form-urlencoded",
      },
      body: input.body.kind === "json" ? JSON.stringify(input.body.payload) : input.body.params,
      signal: AbortSignal.timeout(input.timeoutMs),
    });
  } catch (error) {
    throw new BizError({
      message: `${input.providerLabel} 登录服务调用失败`,
      meta: {
        reason: input.unavailableReason,
      },
      cause: error,
    });
  }

  const rawText = await response.text();
  const parsed = safeParseJson<TParsed>(rawText);

  if (!response.ok) {
    throw new BizError({
      message:
        response.status === 400 || response.status === 401 || response.status === 403
          ? `${input.providerLabel} 登录当前不可用`
          : `${input.providerLabel} 登录服务调用失败`,
      meta: {
        reason: input.unavailableReason,
        status: response.status,
      },
      cause: parsed ?? rawText.slice(0, 500),
    });
  }

  return { parsed, rawText };
}

/** token 响应缺必需字段时的统一报错（措辞逐字保持既有格式）。 */
export function invalidOAuthTicketError(input: {
  providerLabel: string;
  cause: unknown;
}): BizError {
  return new BizError({
    message: `${input.providerLabel} 登录服务返回了无效票据`,
    meta: {
      reason: "AUTH_INVALID_RESPONSE",
    },
    cause: input.cause,
  });
}
