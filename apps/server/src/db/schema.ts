import {
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const llmChatCall = pgTable(
  "llm_chat_call",
  {
    id: serial("id").primaryKey(),
    requestId: text("request_id").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    status: text("status").$type<"success" | "failed">().notNull(),
    requestPayload: jsonb("request_payload").$type<Record<string, unknown>>().notNull(),
    responsePayload: jsonb("response_payload").$type<Record<string, unknown>>(),
    error: jsonb("error").$type<Record<string, unknown>>(),
    latencyMs: integer("latency_ms"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  table => [
    uniqueIndex("llm_chat_call_request_id_uq").on(table.requestId),
    index("llm_chat_call_provider_model_idx").on(table.provider, table.model),
    index("llm_chat_call_created_at_idx").on(table.createdAt),
  ],
);
