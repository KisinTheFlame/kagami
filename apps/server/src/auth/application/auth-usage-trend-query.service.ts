import {
  type AuthUsageTrendQuery,
  type AuthUsageTrendResponse,
} from "@kagami/shared/schemas/auth-usage-trend";
import type { LlmProviderId } from "../../common/contracts/llm.js";

export type QueryAuthUsageTrendInput = {
  provider: LlmProviderId;
  accountId: string | null;
  range: AuthUsageTrendQuery["range"];
};

export interface AuthUsageTrendQueryService {
  query(input: QueryAuthUsageTrendInput): Promise<AuthUsageTrendResponse>;
}
