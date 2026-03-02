import { z } from "zod";

export const HealthResponseSchema = z.object({
  status: z.literal("ok"),
  timestamp: z.string().datetime(),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const GreetingInputSchema = z.object({
  appName: z.string().min(1),
});

export type GreetingInput = z.infer<typeof GreetingInputSchema>;
