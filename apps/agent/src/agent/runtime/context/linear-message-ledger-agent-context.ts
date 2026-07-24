import type { LlmMessage } from "@kagami/llm-client";
import type {
  AgentContext,
  AgentContextDashboardSummary,
  AgentContextSnapshot,
  AssistantMessage,
} from "./agent-context.js";
import type { PersistedAgentContextSnapshot } from "../root-agent/persistence/root-agent-runtime-snapshot.js";
import type { LinearMessageLedgerDao } from "../../capabilities/ledger/infra/linear-message-ledger.dao.js";
import type { LinearMessageLedgerInsert } from "../../capabilities/ledger/domain/ledger.js";

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

  public getRevision(): number {
    return this.inner.getRevision();
  }

  public async getSnapshot(): Promise<AgentContextSnapshot> {
    return await this.inner.getSnapshot();
  }

  public async getLastMessage(): Promise<LlmMessage | null> {
    return await this.inner.getLastMessage();
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

  public async replaceLeadingMessages(count: number, replacement: LlmMessage[]): Promise<void> {
    await this.inner.replaceLeadingMessages(count, replacement);
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
    if (messages.length === 0) {
      return;
    }
    const entries: LinearMessageLedgerInsert[] = messages.map(message => ({
      runtimeKey: this.runtimeKey,
      message,
    }));
    await this.linearMessageLedgerDao.insertMany(entries);
  }
}
