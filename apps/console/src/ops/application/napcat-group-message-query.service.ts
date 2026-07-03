import {
  type NapcatQqMessageListQuery,
  type NapcatQqMessageListResponse,
} from "@kagami/console-api/napcat-group-message";

export interface NapcatQqMessageQueryService {
  queryList(query: NapcatQqMessageListQuery): Promise<NapcatQqMessageListResponse>;
}
