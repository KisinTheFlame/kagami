import type { EmbeddingClient } from "../../../../llm/embedding/client.js";
import type { Story, StoryRagKind, StoryRecord } from "../domain/story.js";
import { STORY_RAG_KINDS, normalizeEmbedding } from "../domain/story.js";
import type { StoryRagDao } from "../infra/story-rag.dao.js";

export class StoryRagService {
  private readonly storyRagDao: StoryRagDao;
  private readonly embeddingClient: EmbeddingClient;
  private readonly outputDimensionality: number;

  public constructor({
    storyRagDao,
    embeddingClient,
    outputDimensionality,
  }: {
    storyRagDao: StoryRagDao;
    embeddingClient: EmbeddingClient;
    outputDimensionality: number;
  }) {
    this.storyRagDao = storyRagDao;
    this.embeddingClient = embeddingClient;
    this.outputDimensionality = outputDimensionality;
  }

  public async reindexStory(story: StoryRecord): Promise<void> {
    const documents = buildStoryRags(story.payload);
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

    await this.storyRagDao.replaceForStory({
      storyId: story.id,
      documents: embeddedDocuments,
    });
  }
}

export function buildStoryRags(story: Story): Array<{
  kind: StoryRagKind;
  content: string;
}> {
  const documents: Array<{ kind: StoryRagKind; content: string }> = [
    {
      kind: "overview",
      content: [
        `标题：${story.title}`,
        story.time ? `时间：${story.time}` : "",
        story.scene ? `场景：${story.scene}` : "",
        story.cause ? `起因：${story.cause}` : "",
        story.result ? `结果：${story.result}` : "",
        story.status ? `当前状态：${story.status}` : "",
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
    document => STORY_RAG_KINDS.includes(document.kind) && document.content.trim().length > 0,
  );
}
