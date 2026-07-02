import type { LlmMessage } from "@kagami/llm-client";

/**
 * 线性消息账本（physical table `ledger`）：root agent 每条进上下文的消息按序追加，
 * 只写不读。作为将来记忆系统的原始素材来源，与任何具体消费者解耦。
 */
export type LinearMessageLedgerRecord = {
  seq: number;
  runtimeKey: string;
  message: LlmMessage;
  createdAt: Date;
};

export type LinearMessageLedgerInsert = Omit<LinearMessageLedgerRecord, "seq" | "createdAt"> & {
  createdAt?: Date;
};
