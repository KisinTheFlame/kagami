export type LoopRunRecordStatus = "running" | "success" | "failed";
export type LoopRunStepRecordStatus = "success" | "failed" | "partial";
export type LoopRunStepRecordType =
  | "trigger_message"
  | "llm_call"
  | "tool_call"
  | "tool_result"
  | "final_result";

export type LoopRunItem = {
  id: string;
  groupId: string;
  triggerMessageId: number | null;
  status: LoopRunRecordStatus;
  triggerPayload: Record<string, unknown>;
  startedAt: Date;
  finishedAt: Date | null;
  durationMs: number | null;
  createdAt: Date;
  updatedAt: Date;
  steps: LoopRunStepItem[];
};

export type LoopRunStepItem = {
  id: number;
  loopRunId: string;
  seq: number;
  type: LoopRunStepRecordType;
  title: string;
  status: LoopRunStepRecordStatus;
  payload: Record<string, unknown>;
  startedAt: Date;
  finishedAt: Date | null;
  durationMs: number | null;
  createdAt: Date;
  updatedAt: Date;
};

export type CreateLoopRunInput = {
  id: string;
  groupId: string;
  triggerMessageId: number | null;
  triggerPayload: Record<string, unknown>;
  startedAt: Date;
};

export type CreateLoopRunStepInput = {
  loopRunId: string;
  seq: number;
  type: LoopRunStepRecordType;
  title: string;
  status: LoopRunStepRecordStatus;
  payload: Record<string, unknown>;
  startedAt: Date;
  finishedAt?: Date | null;
  durationMs?: number | null;
};

export type FinishLoopRunInput = {
  id: string;
  status: Exclude<LoopRunRecordStatus, "running">;
  finishedAt: Date;
  durationMs: number;
};

export interface LoopRunDao {
  createRun(input: CreateLoopRunInput): Promise<void>;
  createStep(input: CreateLoopRunStepInput): Promise<void>;
  finishRun(input: FinishLoopRunInput): Promise<void>;
  findById(id: string): Promise<LoopRunItem | null>;
  countByQuery(input: QueryLoopRunListFilterInput): Promise<number>;
  listPage(input: QueryLoopRunListPageInput): Promise<LoopRunItem[]>;
}

export type QueryLoopRunListFilterInput = {
  status?: "success" | "failed" | "partial";
  groupId?: string;
};

export type QueryLoopRunListPageInput = QueryLoopRunListFilterInput & {
  page: number;
  pageSize: number;
};
