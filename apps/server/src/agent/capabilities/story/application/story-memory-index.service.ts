import type { EmbeddingClient } from "../../../../llm/embedding/client.js";
import type { StoryMemoryDocumentKind, StoryRecord } from "../domain/story.js";
import { STORY_MEMORY_DOCUMENT_KINDS, normalizeEmbedding } from "../domain/story.js";
import type { StoryContent } from "../domain/story-markdown.js";
import type { StoryMemoryDocumentDao } from "../infra/story-memory-document.dao.js";

export class StoryMemoryIndexService {
  private readonly storyMemoryDocumentDao: StoryMemoryDocumentDao;
  private readonly embeddingClient: EmbeddingClient;
  private readonly outputDimensionality: number;

  public constructor({
    storyMemoryDocumentDao,
    embeddingClient,
    outputDimensionality,
  }: {
    storyMemoryDocumentDao: StoryMemoryDocumentDao;
    embeddingClient: EmbeddingClient;
    outputDimensionality: number;
  }) {
    this.storyMemoryDocumentDao = storyMemoryDocumentDao;
    this.embeddingClient = embeddingClient;
    this.outputDimensionality = outputDimensionality;
  }

  public async reindexStory(story: StoryRecord): Promise<void> {
    const documents = buildStoryMemoryDocuments(story.content);
    const embeddedDocuments = await Promise.all(
      documents.map(async document => {
        const response = await this.embeddingClient.embed({
          content: document.content,
          taskType: "RETRIEVAL_DOCUMENT",
          outputDimensionality: this.outputDimensionality,
        });

        return {
          kind: document.kind,
          content: document.content,
          embeddingModel: response.model,
          embeddingDim: response.embedding.length,
          normalizedEmbedding: normalizeEmbedding(response.embedding),
        };
      }),
    );

    await this.storyMemoryDocumentDao.replaceForStory({
      storyId: story.id,
      documents: embeddedDocuments,
    });
  }
}

export function buildStoryMemoryDocuments(story: StoryContent): Array<{
  kind: StoryMemoryDocumentKind;
  content: string;
}> {
  const documents: Array<{ kind: StoryMemoryDocumentKind; content: string }> = [
    {
      kind: "overview",
      content: [
        `标题：${story.title}`,
        story.time ? `时间：${story.time}` : "",
        story.scene ? `场景：${story.scene}` : "",
        story.cause ? `起因：${story.cause}` : "",
        story.result ? `结果：${story.result}` : "",
        story.impact ? `影响：${story.impact}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    },
    {
      kind: "people_scene",
      content: [
        `标题：${story.title}`,
        story.time ? `时间：${story.time}` : "",
        story.scene ? `场景：${story.scene}` : "",
        story.people.length > 0 ? `人物：${story.people.join("、")}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    },
    {
      kind: "process",
      content: [
        `标题：${story.title}`,
        story.process.length > 0 ? `经过：\n- ${story.process.join("\n- ")}` : "经过：",
      ]
        .filter(Boolean)
        .join("\n"),
    },
  ];

  return documents.filter(
    document =>
      STORY_MEMORY_DOCUMENT_KINDS.includes(document.kind) && document.content.trim().length > 0,
  );
}
