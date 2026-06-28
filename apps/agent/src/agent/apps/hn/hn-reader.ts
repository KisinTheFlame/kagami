import { htmlToPlainText } from "./client/sanitize.js";
import type { HnFeed, HnFirebaseClient, HnFirebaseItem } from "./client/firebase.js";
import type {
  HnAlgoliaClient,
  HnAlgoliaTreeNode,
  HnSearchHit,
  HnSearchSort,
  HnSearchTag,
} from "./client/algolia.js";

/**
 * HnReader：HnApp 私有的无状态读取器。编排 Firebase（feed 列表）+ Algolia
 * （评论树 / 搜索）两个 client，做清洗、截断、最热闹排序，吐出已经干净的领域模型。
 *
 * 刻意**不是** ithome 那样的 capability 子系统：HN 是只读请求-响应，没有轮询、
 * 没有 DB、没有 cursor、没有后台、只有 HnApp 一个消费者——所以它只是 App 私有的
 * 一个读取器，整个住在 apps/hn/ 下，不进 capabilities/。ithome 的 DAO/cursor/poller
 * 那套是 RSS（必须轮询 + 落库 + 记未读）逼出来的，HN 一样都不需要。
 *
 * - 领域模型只带 `Date`，不做渲染；格式化交给 context-message-factory（解耦 + 测试确定性）。
 * - 所有面向上下文的文本都过 htmlToPlainText，绝不让原始 HTML 进上下文（Codex #9）。
 */

export type HnConfig = {
  glanceDefaultLimit: number;
  glanceLimitCap: number;
  glanceConcurrency: number;
  commentTopLimit: number;
  commentReplyLimit: number;
  perCommentMaxChars: number;
  responseMaxChars: number;
  searchHitsLimit: number;
  userActivityLimit: number;
};

export type HnStorySummary = {
  id: number;
  title: string;
  by: string | null;
  score: number | null;
  descendants: number | null;
  domain: string | null;
  postedAt: Date | null;
};

export type HnGlanceResult = {
  feed: HnFeed;
  stories: HnStorySummary[];
};

export type HnThreadComment = {
  author: string | null;
  text: string;
  postedAt: Date | null;
  depth: number;
  replyCount: number;
};

export type HnThreadResult = {
  id: number;
  title: string | null;
  url: string | null;
  domain: string | null;
  by: string | null;
  postedAt: Date | null;
  selfText: string | null;
  comments: HnThreadComment[];
  totalRootComments: number;
  shownRootComments: number;
  truncated: boolean;
};

export type HnSearchResultItem = {
  id: number;
  kind: "story" | "comment";
  title: string | null;
  url: string | null;
  domain: string | null;
  author: string | null;
  points: number | null;
  numComments: number | null;
  postedAt: Date | null;
  snippet: string | null;
};

export type HnSearchResult = {
  query: string;
  sort: HnSearchSort;
  hits: HnSearchResultItem[];
};

export type HnUserActivityItem = {
  id: number;
  kind: "story" | "comment";
  title: string | null;
  snippet: string | null;
  postedAt: Date | null;
};

export type HnUserResult = {
  username: string;
  found: boolean;
  karma: number | null;
  createdAt: Date | null;
  about: string | null;
  recent: HnUserActivityItem[];
};

export class HnReader {
  private readonly firebaseClient: HnFirebaseClient;
  private readonly algoliaClient: HnAlgoliaClient;
  private readonly config: HnConfig;

  public constructor({
    firebaseClient,
    algoliaClient,
    config,
  }: {
    firebaseClient: HnFirebaseClient;
    algoliaClient: HnAlgoliaClient;
    config: HnConfig;
  }) {
    this.firebaseClient = firebaseClient;
    this.algoliaClient = algoliaClient;
    this.config = config;
  }

  /** 瞄一眼某个 feed 的 front page。 */
  public async glanceFeed(input: { feed: HnFeed; limit?: number }): Promise<HnGlanceResult> {
    const limit = clampLimit(
      input.limit ?? this.config.glanceDefaultLimit,
      this.config.glanceLimitCap,
    );
    const ids = await this.firebaseClient.fetchFeedIds(input.feed);
    const targetIds = ids.slice(0, limit);
    const items = await mapWithConcurrency(targetIds, this.config.glanceConcurrency, id =>
      this.firebaseClient.fetchItem(id),
    );
    const stories = items
      .filter((item): item is HnFirebaseItem => isLiveItem(item))
      .map(item => this.toStorySummary(item));
    return { feed: input.feed, stories };
  }

  /** 钻进一个 story 的讨论：正文 + 最热闹子树优先的限深限量评论。 */
  public async openThread(input: { id: number }): Promise<HnThreadResult | null> {
    const root = await this.algoliaClient.fetchItemTree(input.id);
    if (!root) {
      return null;
    }

    const rootChildren = root.children ?? [];
    // 最热闹优先：按子树后代总数降序排根评论（评论 points 常为 null，不能靠分数）。
    const sortedRoots = [...rootChildren].sort((a, b) => descendantCount(b) - descendantCount(a));
    const shownRoots = sortedRoots.slice(0, this.config.commentTopLimit);

    const comments: HnThreadComment[] = [];
    let usedChars = 0;
    let truncated = sortedRoots.length > shownRoots.length;

    outer: for (const rootComment of shownRoots) {
      const pushed = this.pushComment(rootComment, 1, comments, usedChars);
      if (!pushed) {
        truncated = true;
        break;
      }
      usedChars = pushed;

      const replies = [...(rootComment.children ?? [])].sort(
        (a, b) => descendantCount(b) - descendantCount(a),
      );
      const shownReplies = replies.slice(0, this.config.commentReplyLimit);
      if (replies.length > shownReplies.length) {
        truncated = true;
      }
      for (const reply of shownReplies) {
        const pushedReply = this.pushComment(reply, 2, comments, usedChars);
        if (!pushedReply) {
          truncated = true;
          break outer;
        }
        usedChars = pushedReply;
      }
    }

    const domain = extractDomain(root.url);
    return {
      id: root.id,
      title: root.title ? htmlToPlainText(root.title) : null,
      url: root.url ?? null,
      domain,
      by: root.author ?? null,
      postedAt: toDate(root.created_at_i),
      selfText: root.text ? htmlToPlainText(root.text) : null,
      comments,
      totalRootComments: rootChildren.length,
      shownRootComments: shownRoots.length,
      truncated,
    };
  }

  /** 全文搜索 HN。 */
  public async searchHn(input: {
    query: string;
    sort?: HnSearchSort;
    tags?: HnSearchTag[];
  }): Promise<HnSearchResult> {
    const sort = input.sort ?? "relevance";
    const hits = await this.algoliaClient.search({
      query: input.query,
      sort,
      tags: input.tags,
      hitsPerPage: this.config.searchHitsLimit,
    });
    return {
      query: input.query,
      sort,
      hits: hits.map(hit => this.toSearchResultItem(hit)),
    };
  }

  /** 认脸：读某用户主页 + 近期发言。 */
  public async openUser(input: { username: string }): Promise<HnUserResult> {
    const user = await this.firebaseClient.fetchUser(input.username);
    if (!user) {
      return {
        username: input.username,
        found: false,
        karma: null,
        createdAt: null,
        about: null,
        recent: [],
      };
    }
    const activity = await this.algoliaClient.fetchAuthorActivity({
      username: user.id,
      hitsPerPage: this.config.userActivityLimit,
    });
    return {
      username: user.id,
      found: true,
      karma: user.karma ?? null,
      createdAt: toDate(user.created),
      about: user.about ? htmlToPlainText(user.about) : null,
      recent: activity.map(hit => this.toUserActivityItem(hit)),
    };
  }

  private toStorySummary(item: HnFirebaseItem): HnStorySummary {
    return {
      id: item.id,
      title: item.title ? htmlToPlainText(item.title) : "(无标题)",
      by: item.by ?? null,
      score: item.score ?? null,
      descendants: item.descendants ?? null,
      domain: extractDomain(item.url),
      postedAt: toDate(item.time),
    };
  }

  private toSearchResultItem(hit: HnSearchHit): HnSearchResultItem {
    const isComment = (hit._tags ?? []).includes("comment") && !(hit._tags ?? []).includes("story");
    const rawSnippet = isComment ? hit.comment_text : hit.story_text;
    return {
      id: Number(hit.objectID),
      kind: isComment ? "comment" : "story",
      title: hit.title ? htmlToPlainText(hit.title) : null,
      url: hit.url ?? null,
      domain: extractDomain(hit.url ?? undefined),
      author: hit.author ?? null,
      points: hit.points ?? null,
      numComments: hit.num_comments ?? null,
      postedAt: toDate(hit.created_at_i),
      snippet: rawSnippet
        ? truncate(htmlToPlainText(rawSnippet), this.config.perCommentMaxChars)
        : null,
    };
  }

  private toUserActivityItem(hit: HnSearchHit): HnUserActivityItem {
    const isComment = (hit._tags ?? []).includes("comment") && !(hit._tags ?? []).includes("story");
    return {
      id: Number(hit.objectID),
      kind: isComment ? "comment" : "story",
      title: hit.title ? htmlToPlainText(hit.title) : null,
      snippet: hit.comment_text
        ? truncate(htmlToPlainText(hit.comment_text), this.config.perCommentMaxChars)
        : null,
      postedAt: toDate(hit.created_at_i),
    };
  }

  /**
   * 把一条评论加入结果列表，并维护总字符预算。返回新的 usedChars；
   * 若加入会超过 responseMaxChars 则返回 null（调用方据此停止并标 truncated）。
   */
  private pushComment(
    node: HnAlgoliaTreeNode,
    depth: number,
    out: HnThreadComment[],
    usedChars: number,
  ): number | null {
    const text = node.text
      ? truncate(htmlToPlainText(node.text), this.config.perCommentMaxChars)
      : "";
    const next = usedChars + text.length;
    if (out.length > 0 && next > this.config.responseMaxChars) {
      return null;
    }
    out.push({
      author: node.author ?? null,
      text,
      postedAt: toDate(node.created_at_i),
      depth,
      replyCount: (node.children ?? []).length,
    });
    return next;
  }
}

function isLiveItem(item: HnFirebaseItem | null): item is HnFirebaseItem {
  return item !== null && item.dead !== true && item.deleted !== true;
}

function descendantCount(node: HnAlgoliaTreeNode): number {
  const children = node.children ?? [];
  return children.reduce((sum, child) => sum + 1 + descendantCount(child), 0);
}

function clampLimit(value: number, cap: number): number {
  if (!Number.isFinite(value) || value < 1) {
    return 1;
  }
  return Math.min(Math.floor(value), cap);
}

function toDate(unixSeconds: number | null | undefined): Date | null {
  if (typeof unixSeconds !== "number" || !Number.isFinite(unixSeconds)) {
    return null;
  }
  return new Date(unixSeconds * 1000);
}

function extractDomain(url: string | null | undefined): string | null {
  if (!url) {
    return null;
  }
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, maxChars).trimEnd()}……`;
}

/** 简单并发池：最多 concurrency 个在飞，保持输入顺序返回结果。 */
async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  const workers = Array.from({ length: workerCount }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}
