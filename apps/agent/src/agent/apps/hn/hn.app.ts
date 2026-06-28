import { z } from "zod";
import type { App, AppStartupContext } from "@kagami/agent-runtime";
import { HnReader } from "./hn-reader.js";
import { DefaultHnFirebaseClient } from "./client/firebase.js";
import { DefaultHnAlgoliaClient } from "./client/algolia.js";
import type { HnFetchOptions } from "./client/hn-fetch.js";
import type { RootAgentEffect } from "../../runtime/effect/root-agent-effect.js";
import { GlanceHnTool } from "./tools/glance-hn.tool.js";
import { OpenHnThreadTool } from "./tools/open-hn-thread.tool.js";
import { SearchHnTool } from "./tools/search-hn.tool.js";
import { OpenHnUserTool } from "./tools/open-hn-user.tool.js";

export const HN_APP_ID = "hn";

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Kagami/1.0";

const PositiveInt = z.number().int().positive();

/**
 * HnApp 配置 schema。全字段带默认值（`.default({})`），所以 config.apps.hn 缺省也能跑。
 * 字段散在这里、由 AppManager.startupAll 按 `server.apps.hn` 切片解析——不经 config.loader
 * （eng review D2：App 原生配置）。
 */
const HnConfigSchema = z
  .object({
    userAgent: z.string().min(1).default(DEFAULT_USER_AGENT),
    fetchTimeoutMs: PositiveInt.default(10_000),
    fetchMaxAttempts: PositiveInt.default(3),
    fetchBackoffBaseMs: PositiveInt.default(500),
    fetchBackoffMaxMs: PositiveInt.default(8_000),
    glanceDefaultLimit: PositiveInt.default(15),
    glanceLimitCap: PositiveInt.default(30),
    glanceConcurrency: PositiveInt.default(6),
    commentTopLimit: PositiveInt.default(20),
    commentReplyLimit: PositiveInt.default(3),
    perCommentMaxChars: PositiveInt.default(600),
    responseMaxChars: PositiveInt.default(8_000),
    searchHitsLimit: PositiveInt.default(15),
    userActivityLimit: PositiveInt.default(10),
  })
  .default({});

type HnConfig = z.infer<typeof HnConfigSchema>;

const HN_AFFORDANCE = [
  "<hn_portal>",
  "你进了 Hacker News。这里没有未读提醒——想看才看。",
  "可调用工具：",
  "  - glance_hn(feed?, limit?)：瞄一眼榜单（top/new/best/ask/show/job）。",
  "  - search_hn(query, sort?, tags?)：搜你关心的话题。",
  "  - open_hn_thread(id)：钻进某个帖子读讨论。",
  "  - open_hn_user(username)：看看某个人是谁。",
  "调 back_to_portal 退出本 App 回到桌面。",
  "</hn_portal>",
].join("\n");

/**
 * Hacker News App。把 HN 的两个只读 API 包装成 Kagami 桌面上的一个能力单元。
 *
 * - 工具：glance_hn / open_hn_thread / search_hn / open_hn_user（全是 InvokeTool 子工具）。
 * - 自管 HnReader：onStartup 时按 config 实例化两个 client + service；工具通过闭包从 App 拿。
 * - onFocus **不自动拉 front page**（与 ithome 不同）：只返回静态、无网络的提示屏。
 *   这比"进门推一脸榜单"更 agency，也让 onFocus 无网络 I/O → 永不因 API 失败而进不去。
 *
 * 设计依据见仓库根 CLAUDE.md，以及 office-hours / CEO / eng review 设计文档。
 */
export class HnApp implements App<HnConfig> {
  public readonly id = HN_APP_ID;
  public readonly displayName = "Hacker News";
  public readonly configSchema = HnConfigSchema;
  public readonly tools: readonly (
    | GlanceHnTool
    | OpenHnThreadTool
    | SearchHnTool
    | OpenHnUserTool
  )[];

  private hnReader: HnReader | null = null;

  public constructor() {
    const getHnReader = (): HnReader => {
      if (!this.hnReader) {
        throw new Error("HnApp 尚未完成 onStartup，HnReader 未就绪");
      }
      return this.hnReader;
    };
    this.tools = [
      new GlanceHnTool({ getHnReader }),
      new OpenHnThreadTool({ getHnReader }),
      new SearchHnTool({ getHnReader }),
      new OpenHnUserTool({ getHnReader }),
    ];
  }

  public canInvoke(): boolean {
    return true;
  }

  public async help(): Promise<string> {
    return [
      "你在 Hacker News App 里。",
      "",
      "可调用工具：",
      "  - glance_hn(feed?, limit?): 瞄一眼榜单的 front page（top/new/best/ask/show/job，默认 top）。",
      "  - search_hn(query, sort?, tags?): 全文搜 HN（sort: relevance/date；tags: story/comment/ask_hn/show_hn）。",
      "  - open_hn_thread(id): 钻进某个帖子读正文和热门评论。",
      "  - open_hn_user(username): 读某个用户的主页和近期发言。",
      "",
      "调 back_to_portal 退出本 App 回到桌面。",
    ].join("\n");
  }

  public async onStartup(ctx: AppStartupContext<HnConfig>): Promise<void> {
    const config = ctx.config;
    const fetchOptions: HnFetchOptions = {
      userAgent: config.userAgent,
      timeoutMs: config.fetchTimeoutMs,
      maxAttempts: config.fetchMaxAttempts,
      backoffBaseMs: config.fetchBackoffBaseMs,
      backoffMaxMs: config.fetchBackoffMaxMs,
    };
    this.hnReader = new HnReader({
      firebaseClient: new DefaultHnFirebaseClient({ fetchOptions }),
      algoliaClient: new DefaultHnAlgoliaClient({ fetchOptions }),
      config: {
        glanceDefaultLimit: config.glanceDefaultLimit,
        glanceLimitCap: config.glanceLimitCap,
        glanceConcurrency: config.glanceConcurrency,
        commentTopLimit: config.commentTopLimit,
        commentReplyLimit: config.commentReplyLimit,
        perCommentMaxChars: config.perCommentMaxChars,
        responseMaxChars: config.responseMaxChars,
        searchHitsLimit: config.searchHitsLimit,
        userActivityLimit: config.userActivityLimit,
      },
    });
  }

  /** 进入 HN：只给静态提示屏，不自动拉榜（无网络 I/O，永不失败）。 */
  public async onFocus(): Promise<readonly RootAgentEffect[]> {
    return [{ type: "append_message", content: HN_AFFORDANCE }];
  }
}
