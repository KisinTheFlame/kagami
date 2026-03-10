import type { RagRuntimeConfig } from "../config/config.manager.js";
import type { NapcatGroupMessageChunkDao } from "../dao/napcat-group-message-chunk.dao.js";
import type {
  NapcatGroupMessageContextItem,
  NapcatGroupMessageDao,
} from "../dao/napcat-group-message.dao.js";
import type { EmbeddingClient } from "../llm/embedding/client.js";
import { normalizeEmbedding } from "./indexer.service.js";

const MEMORY_WINDOW_SIZE = 2;
const DISPLAY_TIME_ZONE = "Asia/Shanghai";

export class GroupMessageMemorySearchService {
  private readonly config: RagRuntimeConfig;
  private readonly embeddingClient: EmbeddingClient;
  private readonly chunkDao: NapcatGroupMessageChunkDao;
  private readonly groupMessageDao: NapcatGroupMessageDao;

  public constructor({
    config,
    embeddingClient,
    chunkDao,
    groupMessageDao,
  }: {
    config: RagRuntimeConfig;
    embeddingClient: EmbeddingClient;
    chunkDao: NapcatGroupMessageChunkDao;
    groupMessageDao: NapcatGroupMessageDao;
  }) {
    this.config = config;
    this.embeddingClient = embeddingClient;
    this.chunkDao = chunkDao;
    this.groupMessageDao = groupMessageDao;
  }

  public async search(input: { groupId: string; query: string }): Promise<string> {
    const query = input.query.trim();
    if (query.length === 0) {
      return "";
    }

    const response = await this.embeddingClient.embed({
      content: query,
      taskType: "RETRIEVAL_QUERY",
      outputDimensionality: this.config.embedding.outputDimensionality,
    });
    const hits = await this.chunkDao.searchSimilar({
      groupId: input.groupId,
      queryEmbedding: normalizeEmbedding(response.embedding),
      topK: this.config.retrieval.topK,
    });
    if (hits.length === 0) {
      return "";
    }

    const blocks = await Promise.all(
      hits.map(async hit => {
        const messages = await this.groupMessageDao.listContextWindowById({
          groupId: input.groupId,
          messageId: hit.sourceMessageId,
          before: MEMORY_WINDOW_SIZE,
          after: MEMORY_WINDOW_SIZE,
        });

        return formatMemoryHistoryBlock({
          centerMessageId: hit.sourceMessageId,
          messages,
        });
      }),
    );

    return blocks.filter(block => block.length > 0).join("\n");
  }
}

function formatMemoryHistoryBlock(input: {
  centerMessageId: number;
  messages: NapcatGroupMessageContextItem[];
}): string {
  if (input.messages.length === 0) {
    return "";
  }

  const centerMessage =
    input.messages.find(message => message.id === input.centerMessageId) ?? input.messages[0];

  return [
    "<memory_history_message>",
    `时间：${formatDisplayTime(centerMessage.eventTime ?? centerMessage.createdAt)}`,
    ...input.messages.flatMap(message => [
      "<message>",
      `${message.nickname ?? "未知昵称"} (${message.userId ?? "unknown"}):`,
      message.messageText,
      "</message>",
    ]),
    "</memory_history_message>",
  ].join("\n");
}

function formatDisplayTime(value: Date): string {
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: DISPLAY_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(value);
  const mapped = Object.fromEntries(parts.map(part => [part.type, part.value]));

  return `${mapped.year}-${mapped.month}-${mapped.day} ${mapped.hour}:${mapped.minute}:${mapped.second}`;
}
