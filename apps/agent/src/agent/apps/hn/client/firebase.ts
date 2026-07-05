import { z } from "zod";
import { hnFetchJson, type HnFetchOptions } from "./hn-fetch.js";

/** HN 官方 Firebase API 的只读 baseURL。 */
const HN_FIREBASE_BASE_URL = "https://hacker-news.firebaseio.com/v0";

export type HnFeed = "top" | "new" | "best" | "ask" | "show" | "job";

const FEED_ENDPOINT: Record<HnFeed, string> = {
  top: "topstories",
  new: "newstories",
  best: "beststories",
  ask: "askstories",
  show: "showstories",
  job: "jobstories",
};

/**
 * Firebase item 的宽松 schema。HN 的 item 形态多变：可能是 null、可能 dead/deleted、
 * 可能是 job/poll（无 url、无 descendants）、time 是 Unix 秒。一律宽松解析，
 * 由 service 决定怎么过滤 / 转换（Codex 冷读 #14）。
 */
const FirebaseItemSchema = z.object({
  id: z.number(),
  type: z.string().optional(),
  by: z.string().optional(),
  time: z.number().optional(),
  title: z.string().optional(),
  url: z.string().optional(),
  text: z.string().optional(),
  score: z.number().optional(),
  descendants: z.number().optional(),
  kids: z.array(z.number()).optional(),
  dead: z.boolean().optional(),
  deleted: z.boolean().optional(),
});

export type HnFirebaseItem = z.infer<typeof FirebaseItemSchema>;

const FirebaseUserSchema = z.object({
  id: z.string(),
  created: z.number().optional(),
  karma: z.number().optional(),
  about: z.string().optional(),
  submitted: z.array(z.number()).optional(),
});

export type HnFirebaseUser = z.infer<typeof FirebaseUserSchema>;

export interface HnFirebaseClient {
  /** 拉某个 feed 的已排序 id 列表（最多 500）。 */
  fetchFeedIds(feed: HnFeed): Promise<number[]>;
  /** 拉单个 item；不存在 / null 返回 null。 */
  fetchItem(id: number): Promise<HnFirebaseItem | null>;
  /** 拉用户主页；不存在 / null 返回 null。 */
  fetchUser(username: string): Promise<HnFirebaseUser | null>;
}

type DefaultHnFirebaseClientDeps = {
  baseUrl?: string;
  fetchOptions: HnFetchOptions;
};

export class DefaultHnFirebaseClient implements HnFirebaseClient {
  private readonly baseUrl: string;
  private readonly fetchOptions: HnFetchOptions;

  public constructor({ baseUrl, fetchOptions }: DefaultHnFirebaseClientDeps) {
    this.baseUrl = baseUrl ?? HN_FIREBASE_BASE_URL;
    this.fetchOptions = fetchOptions;
  }

  public async fetchFeedIds(feed: HnFeed): Promise<number[]> {
    const raw = await hnFetchJson(`${this.baseUrl}/${FEED_ENDPOINT[feed]}.json`, this.fetchOptions);
    const parsed = z.array(z.number()).safeParse(raw);
    return parsed.success ? parsed.data : [];
  }

  public async fetchItem(id: number): Promise<HnFirebaseItem | null> {
    const raw = await hnFetchJson(`${this.baseUrl}/item/${id}.json`, this.fetchOptions);
    if (raw === null) {
      return null;
    }
    const parsed = FirebaseItemSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  }

  public async fetchUser(username: string): Promise<HnFirebaseUser | null> {
    const raw = await hnFetchJson(
      `${this.baseUrl}/user/${encodeURIComponent(username)}.json`,
      this.fetchOptions,
    );
    if (raw === null) {
      return null;
    }
    const parsed = FirebaseUserSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  }
}
