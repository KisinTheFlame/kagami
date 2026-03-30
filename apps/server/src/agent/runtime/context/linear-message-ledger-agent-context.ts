import type { LlmMessage } from "../../../llm/types.js";
import type {
  AgentContext,
  AgentContextDashboardSummary,
  AgentContextSnapshot,
  AssistantMessage,
} from "./agent-context.js";
import type { Event } from "../event/event.js";
import type { PersistedAgentContextSnapshot } from "../root-agent/persistence/root-agent-runtime-snapshot.js";
import type { LinearMessageLedgerDao } from "../../capabilities/story/infra/linear-message-ledger.dao.js";
import type { LinearMessageLedgerInsert } from "../../capabilities/story/domain/story.js";
import { createContextItemFromEvent, renderContextItemToMessages } from "./context-item.utils.js";

export class LinearMessageLedgerAgentContext implements AgentContext {
  private readonly inner: AgentContext;
  private readonly linearMessageLedgerDao: LinearMessageLedgerDao;
  private readonly runtimeKey: string;

  public constructor({
    inner,
    linearMessageLedgerDao,
    runtimeKey,
  }: {
    inner: AgentContext;
    linearMessageLedgerDao: LinearMessageLedgerDao;
    runtimeKey: string;
  }) {
    this.inner = inner;
    this.linearMessageLedgerDao = linearMessageLedgerDao;
    this.runtimeKey = runtimeKey;
  }

  public async getSnapshot(): Promise<AgentContextSnapshot> {
    return await this.inner.getSnapshot();
  }

  public async fork(): Promise<AgentContext> {
    return await this.inner.fork();
  }

  public async exportPersistedSnapshot(): Promise<PersistedAgentContextSnapshot> {
    return await this.inner.exportPersistedSnapshot();
  }

  public async restorePersistedSnapshot(snapshot: PersistedAgentContextSnapshot): Promise<void> {
    await this.inner.restorePersistedSnapshot(snapshot);
  }

  public async reset(): Promise<void> {
    await this.inner.reset();
  }

  public async appendEvents(events: Event[]): Promise<void> {
    await this.inner.appendEvents(events);
    await this.writeLedgerEntries(
      events.flatMap(event => renderContextItemToMessages(createContextItemFromEvent(event))),
    );
  }

  public async appendMessages(messages: LlmMessage[]): Promise<void> {
    await this.inner.appendMessages(messages);
    await this.writeLedgerEntries(messages);
  }

  public async appendAssistantTurn(message: AssistantMessage): Promise<void> {
    await this.inner.appendAssistantTurn(message);
    await this.writeLedgerEntries([message]);
  }

  public async appendToolResult(input: { toolCallId: string; content: string }): Promise<void> {
    const message: LlmMessage = {
      role: "tool",
      toolCallId: input.toolCallId,
      content: input.content,
    };
    await this.inner.appendToolResult(input);
    await this.writeLedgerEntries([message]);
  }

  public async replaceMessages(messages: LlmMessage[]): Promise<void> {
    await this.inner.replaceMessages(messages);
  }

  public async getDashboardSummary(input?: {
    limit?: number;
    previewLength?: number;
  }): Promise<AgentContextDashboardSummary> {
    return await this.inner.getDashboardSummary(input);
  }

  private async writeLedgerEntries(
    messages: LinearMessageLedgerInsert["message"][],
  ): Promise<void> {
    const entries = messages
      .map(message =>
        toLinearMessageLedgerInsert({
          runtimeKey: this.runtimeKey,
          message,
        }),
      )
      .filter((entry): entry is LinearMessageLedgerInsert => Boolean(entry));
    await this.linearMessageLedgerDao.insertMany(entries);
  }
}

function toLinearMessageLedgerInsert(input: {
  runtimeKey: string;
  message: LinearMessageLedgerInsert["message"];
}): LinearMessageLedgerInsert | null {
  return {
    runtimeKey: input.runtimeKey,
    message: input.message,
  };
}
