import {
  type NapcatEventListQuery,
  type NapcatEventListResponse,
} from "@kagami/shared/schemas/napcat-event";

export interface NapcatEventQueryService {
  queryList(query: NapcatEventListQuery): Promise<NapcatEventListResponse>;
}
