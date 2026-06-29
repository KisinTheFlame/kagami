import {
  type StoryListQuery,
  type StoryListResponse,
  StoryItemSchema,
} from "@kagami/shared/schemas/story";
import type { StoryRecallService } from "../../agent/capabilities/story/application/story-recall.service.js";
import type { StoryRecord } from "../../agent/capabilities/story/domain/story.js";
import type { StoryDao } from "../../agent/capabilities/story/infra/story.dao.js";
import type { StoryQueryService } from "./story-query.service.js";

const DEFAULT_SEARCH_TOP_K = 100;
// 向量召回 topK 的硬上限：防止深翻页（page * pageSize 很大）把 topK 抬到无界，
// 进而退化成「全量取回再 slice」。语义为 capped：topK 不超过 MAX_SEARCH_TOP_K，
// 超出该窗口的深翻页 offset 会落在召回结果之外，slice 后自然返回空数组（不抛错）。
const MAX_SEARCH_TOP_K = 200;

type DefaultStoryQueryServiceDeps = {
  storyDao: StoryDao;
  storyRecallService: StoryRecallService;
};

export class DefaultStoryQueryService implements StoryQueryService {
  private readonly storyDao: StoryDao;
  private readonly storyRecallService: StoryRecallService;

  public constructor({ storyDao, storyRecallService }: DefaultStoryQueryServiceDeps) {
    this.storyDao = storyDao;
    this.storyRecallService = storyRecallService;
  }

  public async queryList(query: StoryListQuery): Promise<StoryListResponse> {
    if (query.query) {
      const topK = Math.min(
        MAX_SEARCH_TOP_K,
        Math.max(DEFAULT_SEARCH_TOP_K, query.page * query.pageSize),
      );
      const results = await this.storyRecallService.search({
        query: query.query,
        topK,
      });
      const offset = (query.page - 1) * query.pageSize;
      const pagedItems = results.slice(offset, offset + query.pageSize);

      return {
        pagination: {
          page: query.page,
          pageSize: query.pageSize,
          total: results.length,
        },
        items: pagedItems.map(result =>
          mapStoryItem({
            story: result.story,
            score: result.score,
            matchedKinds: result.matchedKinds,
          }),
        ),
      };
    }

    const [total, stories] = await Promise.all([
      this.storyDao.countAll(),
      this.storyDao.listPage({
        page: query.page,
        pageSize: query.pageSize,
        orderBy: "createdAtDesc",
      }),
    ]);

    return {
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
      },
      items: stories.map(story =>
        mapStoryItem({
          story,
          score: null,
          matchedKinds: [],
        }),
      ),
    };
  }
}

function mapStoryItem(input: { story: StoryRecord; score: number | null; matchedKinds: string[] }) {
  return StoryItemSchema.parse({
    id: input.story.id,
    markdown: input.story.markdown,
    title: input.story.content.title,
    time: input.story.content.time,
    scene: input.story.content.scene,
    people: input.story.content.people,
    impact: input.story.content.impact,
    sourceMessageSeqStart: input.story.sourceMessageSeqStart,
    sourceMessageSeqEnd: input.story.sourceMessageSeqEnd,
    createdAt: input.story.createdAt.toISOString(),
    updatedAt: input.story.updatedAt.toISOString(),
    score: input.score,
    matchedKinds: input.matchedKinds.filter(
      kind => kind === "overview" || kind === "people_scene" || kind === "process",
    ),
  });
}
