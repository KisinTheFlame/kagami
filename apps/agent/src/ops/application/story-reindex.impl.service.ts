import type {
  StoryReindexFailure,
  StoryReindexMode,
  StoryReindexRequest,
  StoryReindexResponse,
} from "@kagami/shared/schemas/story";
import { buildStoryMemoryDocuments } from "../../agent/capabilities/story/application/story-memory-index.service.js";
import type { StoryMemoryIndexService } from "../../agent/capabilities/story/application/story-memory-index.service.js";
import type { StoryRecord } from "../../agent/capabilities/story/domain/story.js";
import type {
  StoryMemoryDocumentDao,
  StoryMemoryDocumentIndexMetadata,
} from "../../agent/capabilities/story/infra/story-memory-document.dao.js";
import type { StoryDao } from "../../agent/capabilities/story/infra/story.dao.js";
import type { StoryReindexService } from "./story-reindex.service.js";

const MAX_FAILURES = 20;

type DefaultStoryReindexServiceDeps = {
  storyDao: StoryDao;
  storyMemoryDocumentDao: StoryMemoryDocumentDao;
  storyMemoryIndexService: StoryMemoryIndexService;
  embeddingModel: string;
  outputDimensionality: number;
};

export class DefaultStoryReindexService implements StoryReindexService {
  private readonly storyDao: StoryDao;
  private readonly storyMemoryDocumentDao: StoryMemoryDocumentDao;
  private readonly storyMemoryIndexService: StoryMemoryIndexService;
  private readonly embeddingModel: string;
  private readonly outputDimensionality: number;

  public constructor({
    storyDao,
    storyMemoryDocumentDao,
    storyMemoryIndexService,
    embeddingModel,
    outputDimensionality,
  }: DefaultStoryReindexServiceDeps) {
    this.storyDao = storyDao;
    this.storyMemoryDocumentDao = storyMemoryDocumentDao;
    this.storyMemoryIndexService = storyMemoryIndexService;
    this.embeddingModel = embeddingModel;
    this.outputDimensionality = outputDimensionality;
  }

  public async reindex(input: StoryReindexRequest): Promise<StoryReindexResponse> {
    const totalStories = await this.storyDao.countAll();
    const failures: StoryReindexFailure[] = [];
    let targetedStories = 0;
    let reindexedStories = 0;
    let skippedStories = 0;
    let failedStories = 0;

    for (let page = 1; ; page += 1) {
      const stories = await this.storyDao.listPage({
        page,
        pageSize: input.pageSize,
        orderBy: "createdAtAsc",
      });
      if (stories.length === 0) {
        break;
      }

      const storiesToReindex = await this.resolveStoriesToReindex({
        stories,
        mode: input.mode,
      });
      targetedStories += storiesToReindex.length;
      skippedStories += stories.length - storiesToReindex.length;

      for (const story of storiesToReindex) {
        try {
          await this.storyMemoryIndexService.reindexStory(story);
          reindexedStories += 1;
        } catch (error) {
          failedStories += 1;
          if (failures.length < MAX_FAILURES) {
            failures.push({
              storyId: story.id,
              message: getErrorMessage(error),
            });
          }
        }
      }
    }

    return {
      mode: input.mode,
      totalStories,
      targetedStories,
      reindexedStories,
      skippedStories,
      failedStories,
      failures,
    };
  }

  private async resolveStoriesToReindex(input: {
    stories: StoryRecord[];
    mode: StoryReindexMode;
  }): Promise<StoryRecord[]> {
    if (input.mode === "all") {
      return input.stories;
    }

    const metadata = await this.storyMemoryDocumentDao.findIndexMetadataByStoryIds(
      input.stories.map(story => story.id),
    );
    const metadataByStoryId = new Map<string, StoryMemoryDocumentIndexMetadata[]>();

    for (const document of metadata) {
      const documents = metadataByStoryId.get(document.storyId) ?? [];
      documents.push(document);
      metadataByStoryId.set(document.storyId, documents);
    }

    return input.stories.filter(story =>
      shouldReindexStory({
        story,
        documents: metadataByStoryId.get(story.id) ?? [],
        embeddingModel: this.embeddingModel,
        outputDimensionality: this.outputDimensionality,
      }),
    );
  }
}

function shouldReindexStory(input: {
  story: StoryRecord;
  documents: StoryMemoryDocumentIndexMetadata[];
  embeddingModel: string;
  outputDimensionality: number;
}): boolean {
  if (input.documents.length === 0) {
    return true;
  }

  const expectedKinds = buildStoryMemoryDocuments(input.story.content).map(
    document => document.kind,
  );
  const actualKinds = input.documents.map(document => document.kind);
  if (input.documents.length !== expectedKinds.length) {
    return true;
  }

  const expectedKindSet = new Set(expectedKinds);
  const actualKindSet = new Set(actualKinds);
  if (actualKindSet.size !== expectedKindSet.size) {
    return true;
  }

  for (const kind of expectedKindSet) {
    if (!actualKindSet.has(kind)) {
      return true;
    }
  }

  for (const document of input.documents) {
    if (!expectedKindSet.has(document.kind)) {
      return true;
    }
    if (document.embeddingModel !== input.embeddingModel) {
      return true;
    }
    if (document.embeddingDim !== input.outputDimensionality) {
      return true;
    }
  }

  return false;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return "Unknown error";
}
