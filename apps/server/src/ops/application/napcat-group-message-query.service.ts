import {
  type NapcatQqMessageListQuery,
  type NapcatQqMessageListResponse,
} from "@kagami/shared/schemas/napcat-group-message";

export interface NapcatQqMessageQueryService {
  queryList(query: NapcatQqMessageListQuery): Promise<NapcatQqMessageListResponse>;
}
