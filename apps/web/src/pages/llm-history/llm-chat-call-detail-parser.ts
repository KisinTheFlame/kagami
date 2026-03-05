import {
  LlmChatErrorPayloadSchema,
  LlmChatRequestPayloadSchema,
  LlmChatResponsePayloadSchema,
  type LlmChatCallItem,
  type LlmChatErrorPayload,
  type LlmChatRequestPayload,
  type LlmChatResponsePayload,
} from "@kagami/shared";

export type LlmChatCallDetailParseResult = {
  request: LlmChatRequestPayload | null;
  response: LlmChatResponsePayload | null;
  error: LlmChatErrorPayload | null;
  hasSchemaError: boolean;
  schemaErrors: string[];
};

export function parseLlmChatCallDetail(item: LlmChatCallItem): LlmChatCallDetailParseResult {
  const requestParsed = LlmChatRequestPayloadSchema.safeParse(item.requestPayload);
  const responseParsed =
    item.responsePayload === null ? null : LlmChatResponsePayloadSchema.safeParse(item.responsePayload);
  const errorParsed = item.error === null ? null : LlmChatErrorPayloadSchema.safeParse(item.error);

  const schemaErrors: string[] = [];
  if (!requestParsed.success) {
    schemaErrors.push(`requestPayload: ${formatIssueSummary(requestParsed.error.issues)}`);
  }

  if (item.status === "success") {
    if (responseParsed === null) {
      schemaErrors.push("responsePayload: 成功记录缺少 responsePayload");
    } else if (!responseParsed.success) {
      schemaErrors.push(`responsePayload: ${formatIssueSummary(responseParsed.error.issues)}`);
    }
  }

  if (item.status === "failed") {
    if (errorParsed === null) {
      schemaErrors.push("error: 失败记录缺少 error");
    } else if (!errorParsed.success) {
      schemaErrors.push(`error: ${formatIssueSummary(errorParsed.error.issues)}`);
    }
  }

  return {
    request: requestParsed.success ? requestParsed.data : null,
    response: responseParsed?.success ? responseParsed.data : null,
    error: errorParsed?.success ? errorParsed.data : null,
    hasSchemaError: schemaErrors.length > 0,
    schemaErrors,
  };
}

function formatIssueSummary(
  issues: Array<{
    path: Array<string | number>;
    message: string;
  }>,
): string {
  return issues
    .slice(0, 3)
    .map(issue => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
      return `${path} ${issue.message}`;
    })
    .join("; ");
}
