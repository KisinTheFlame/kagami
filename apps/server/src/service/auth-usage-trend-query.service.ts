import type { AuthUsageTrendQuery, AuthUsageTrendResponse } from "@kagami/shared";
import type { LlmProviderId } from "../llm/types.js";

export type QueryAuthUsageTrendInput = {
  provider: LlmProviderId;
  accountId: string | null;
  range: AuthUsageTrendQuery["range"];
};

export interface AuthUsageTrendQueryService {
  query(input: QueryAuthUsageTrendInput): Promise<AuthUsageTrendResponse>;
}
