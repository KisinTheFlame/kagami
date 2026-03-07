import { z } from "./base.js";

export const HealthQuerySchema = z.object({}).passthrough();

export type HealthQuery = z.infer<typeof HealthQuerySchema>;

export const HealthResponseSchema = z.object({
  status: z.literal("ok"),
  timestamp: z.string().datetime(),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;
