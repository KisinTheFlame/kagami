import {
  type InnerThoughtListQuery,
  type InnerThoughtListResponse,
} from "@kagami/console-api/inner-thought";

export interface InnerThoughtQueryService {
  queryList(query: InnerThoughtListQuery): Promise<InnerThoughtListResponse>;
}
