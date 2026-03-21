CREATE TABLE "agent_round_trace" (
  "id" SERIAL NOT NULL,
  "group_id" TEXT NOT NULL,
  "trigger_event_message_ids" JSONB NOT NULL,
  "trigger_signals" JSONB NOT NULL,
  "precheck_decision" TEXT NOT NULL,
  "tool_sequence" JSONB NOT NULL,
  "send_count" INTEGER NOT NULL,
  "outbound_message_ids" JSONB NOT NULL,
  "end_reason" TEXT NOT NULL,
  "detail" JSONB NOT NULL,
  "started_at" TIMESTAMPTZ(6) NOT NULL,
  "ended_at" TIMESTAMPTZ(6) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "agent_round_trace_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "agent_round_trace_group_id_started_at_idx"
ON "agent_round_trace"("group_id", "started_at");

CREATE INDEX "agent_round_trace_end_reason_started_at_idx"
ON "agent_round_trace"("end_reason", "started_at");

CREATE INDEX "agent_round_trace_started_at_idx"
ON "agent_round_trace"("started_at");
