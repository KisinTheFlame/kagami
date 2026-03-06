import { z } from "./base.js";

export const AgentRunRequestSchema = z.object({
  input: z.string().min(1),
});

export type AgentRunRequest = z.infer<typeof AgentRunRequestSchema>;

export const AgentRunResponseSchema = z.object({
  output: z.string(),
  steps: z.number().int().positive(),
});

export type AgentRunResponse = z.infer<typeof AgentRunResponseSchema>;
