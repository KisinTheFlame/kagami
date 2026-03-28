import {
  type NapcatGroupMessageListQuery,
  type NapcatGroupMessageListResponse,
} from "@kagami/shared/schemas/napcat-group-message";

export interface NapcatGroupMessageQueryService {
  queryList(query: NapcatGroupMessageListQuery): Promise<NapcatGroupMessageListResponse>;
}
