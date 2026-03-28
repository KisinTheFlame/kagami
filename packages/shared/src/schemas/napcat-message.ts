import { z } from "zod";

export const NapcatSendGroupMessageRequestSchema = z
  .object({
    message: z.string().min(1),
  })
  .strict();

export type NapcatSendGroupMessageRequest = z.infer<typeof NapcatSendGroupMessageRequestSchema>;

export const NapcatSendGroupMessageResponseSchema = z.object({
  messageId: z.number().int().positive(),
});

export type NapcatSendGroupMessageResponse = z.infer<typeof NapcatSendGroupMessageResponseSchema>;
