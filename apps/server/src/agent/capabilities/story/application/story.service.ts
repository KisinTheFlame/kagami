import type { Story, StoryRecord } from "../domain/story.js";
import type { StoryDao } from "../infra/story.dao.js";
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
    payload: Story;
    sourceMessageSeqStart: number;
    sourceMessageSeqEnd: number;
  }): Promise<StoryRecord> {
    const story = await this.storyDao.create(input);
    await this.storyMemoryIndexService.reindexStory(story);
    return story;
  }

  public async rewrite(input: {
    storyId: string;
    payload: Story;
    sourceMessageSeqStart: number;
    sourceMessageSeqEnd: number;
  }): Promise<StoryRecord> {
    const existing = await this.storyDao.findById(input.storyId);
    if (!existing) {
      throw new Error(`Story not found: ${input.storyId}`);
    }

    const story = await this.storyDao.update({
      id: input.storyId,
      payload: input.payload,
      sourceMessageSeqStart: Math.min(existing.sourceMessageSeqStart, input.sourceMessageSeqStart),
      sourceMessageSeqEnd: Math.max(existing.sourceMessageSeqEnd, input.sourceMessageSeqEnd),
    });
    await this.storyMemoryIndexService.reindexStory(story);
    return story;
  }
}
