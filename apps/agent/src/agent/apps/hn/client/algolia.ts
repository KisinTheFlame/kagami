import { z } from "zod";
import { hnFetchJson, type HnFetchOptions } from "./hn-fetch.js";

/** HN 官方背书的第三方搜索 API（Algolia）只读 baseURL。 */
export const HN_ALGOLIA_BASE_URL = "https://hn.algolia.com/api/v1";

export type HnSearchSort = "relevance" | "date";
export type HnSearchTag = "story" | "comment" | "ask_hn" | "show_hn";

/** 搜索命中（宽松解析；只取我们渲染要用的字段）。 */
const SearchHitSchema = z.object({
  objectID: z.string(),
  title: z.string().nullish(),
  url: z.string().nullish(),
  author: z.string().nullish(),
  points: z.number().nullish(),
  num_comments: z.number().nullish(),
  created_at_i: z.number().nullish(),
  story_text: z.string().nullish(),
  comment_text: z.string().nullish(),
  story_id: z.number().nullish(),
  _tags: z.array(z.string()).nullish(),
});

export type HnSearchHit = z.infer<typeof SearchHitSchema>;

const SearchResponseSchema = z.object({
  hits: z.array(SearchHitSchema).default([]),
});

/**
 * items/<id> 的嵌套评论树节点。children 递归，用 z.lazy。
 * 评论的 points 常为 null、title/url 为 null；root 才有 title/url。
 */
export type HnAlgoliaTreeNode = {
  id: number;
  type: string | null;
  author: string | null;
  text: string | null;
  title: string | null;
  url: string | null;
  points: number | null;
  created_at_i: number | null;
  children: HnAlgoliaTreeNode[];
};

const TreeNodeSchema: z.ZodType<HnAlgoliaTreeNode, z.ZodTypeDef, unknown> = z.lazy(() =>
  z.object({
    id: z.number(),
    type: z
      .string()
      .nullish()
      .transform(v => v ?? null),
    author: z
      .string()
      .nullish()
      .transform(v => v ?? null),
    text: z
      .string()
      .nullish()
      .transform(v => v ?? null),
    title: z
      .string()
      .nullish()
      .transform(v => v ?? null),
    url: z
      .string()
      .nullish()
      .transform(v => v ?? null),
    points: z
      .number()
      .nullish()
      .transform(v => v ?? null),
    created_at_i: z
      .number()
      .nullish()
      .transform(v => v ?? null),
    children: z.array(TreeNodeSchema).default([]),
  }),
);

export interface HnAlgoliaClient {
  /** 全文搜索。sort=relevance 走 /search（按热度）；sort=date 走 /search_by_date。 */
  search(input: {
    query: string;
    sort: HnSearchSort;
    tags?: HnSearchTag[];
    hitsPerPage: number;
  }): Promise<HnSearchHit[]>;
  /** 取一个 story 的完整嵌套评论树；不存在返回 null。 */
  fetchItemTree(id: number): Promise<HnAlgoliaTreeNode | null>;
  /** 取某用户近期发言（story + comment），按时间倒序。 */
  fetchAuthorActivity(input: { username: string; hitsPerPage: number }): Promise<HnSearchHit[]>;
}

type DefaultHnAlgoliaClientDeps = {
  baseUrl?: string;
  fetchOptions: HnFetchOptions;
};

export class DefaultHnAlgoliaClient implements HnAlgoliaClient {
  private readonly baseUrl: string;
  private readonly fetchOptions: HnFetchOptions;

  public constructor({ baseUrl, fetchOptions }: DefaultHnAlgoliaClientDeps) {
    this.baseUrl = baseUrl ?? HN_ALGOLIA_BASE_URL;
    this.fetchOptions = fetchOptions;
  }

  public async search(input: {
    query: string;
    sort: HnSearchSort;
    tags?: HnSearchTag[];
    hitsPerPage: number;
  }): Promise<HnSearchHit[]> {
    const endpoint = input.sort === "date" ? "search_by_date" : "search";
    const params = new URLSearchParams({
      query: input.query,
      hitsPerPage: String(input.hitsPerPage),
    });
    if (input.tags && input.tags.length > 0) {
      // 逗号 = AND；HN 的 story/comment/ask_hn/show_hn 直接作为 tag 传。
      params.set("tags", input.tags.join(","));
    }
    const raw = await hnFetchJson(
      `${this.baseUrl}/${endpoint}?${params.toString()}`,
      this.fetchOptions,
    );
    const parsed = SearchResponseSchema.safeParse(raw);
    return parsed.success ? parsed.data.hits : [];
  }

  public async fetchItemTree(id: number): Promise<HnAlgoliaTreeNode | null> {
    const raw = await hnFetchJson(`${this.baseUrl}/items/${id}`, this.fetchOptions);
    if (raw === null) {
      return null;
    }
    const parsed = TreeNodeSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  }

  public async fetchAuthorActivity(input: {
    username: string;
    hitsPerPage: number;
  }): Promise<HnSearchHit[]> {
    const params = new URLSearchParams({
      tags: `author_${input.username}`,
      hitsPerPage: String(input.hitsPerPage),
    });
    const raw = await hnFetchJson(
      `${this.baseUrl}/search_by_date?${params.toString()}`,
      this.fetchOptions,
    );
    const parsed = SearchResponseSchema.safeParse(raw);
    return parsed.success ? parsed.data.hits : [];
  }
}
