import type { StoryRecord } from "../domain/story.js";
import type { StoryDao } from "../infra/story.dao.js";
import { formatStoryMarkdown, parseStoryMarkdown } from "../domain/story-markdown.js";
import { StoryMemoryIndexService } from "./story-memory-index.service.js";

export class StoryService {
  private readonly storyDao: StoryDao;
  private readonly storyMemoryIndexService: StoryMemoryIndexService;

  public constructor({
    storyDao,
    storyMemoryIndexService,
  }: {
    storyDao: StoryDao;
    storyMemoryIndexService: StoryMemoryIndexService;
  }) {
    this.storyDao = storyDao;
    this.storyMemoryIndexService = storyMemoryIndexService;
  }

  public async create(input: {
    markdown: string;
    sourceMessageSeqStart: number;
    sourceMessageSeqEnd: number;
  }): Promise<StoryRecord> {
    const normalizedMarkdown = formatStoryMarkdown(parseStoryMarkdown(input.markdown));
    const story = await this.storyDao.create({
      ...input,
      markdown: normalizedMarkdown,
    });
    await this.storyMemoryIndexService.reindexStory(story);
    return story;
  }

  public async rewrite(input: {
    storyId: string;
    markdown: string;
    sourceMessageSeqStart: number;
    sourceMessageSeqEnd: number;
  }): Promise<StoryRecord> {
    const existing = await this.storyDao.findById(input.storyId);
    if (!existing) {
      throw new Error(`Story not found: ${input.storyId}`);
    }

    const normalizedMarkdown = formatStoryMarkdown(parseStoryMarkdown(input.markdown));
    const story = await this.storyDao.update({
      id: input.storyId,
      markdown: normalizedMarkdown,
      sourceMessageSeqStart: Math.min(existing.sourceMessageSeqStart, input.sourceMessageSeqStart),
      sourceMessageSeqEnd: Math.max(existing.sourceMessageSeqEnd, input.sourceMessageSeqEnd),
    });
    await this.storyMemoryIndexService.reindexStory(story);
    return story;
  }
}
