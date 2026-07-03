import {
  type NapcatEventListQuery,
  type NapcatEventListResponse,
} from "@kagami/console-api/napcat-event";

export interface NapcatEventQueryService {
  queryList(query: NapcatEventListQuery): Promise<NapcatEventListResponse>;
}
