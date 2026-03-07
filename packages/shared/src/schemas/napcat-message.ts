import { z } from "./base.js";

export const NapcatSendGroupMessageRequestSchema = z.object({
  groupId: z.string().min(1),
  message: z.string().min(1),
});

export type NapcatSendGroupMessageRequest = z.infer<typeof NapcatSendGroupMessageRequestSchema>;

export const NapcatSendGroupMessageResponseSchema = z.object({
  messageId: z.number().int().positive(),
});

export type NapcatSendGroupMessageResponse = z.infer<typeof NapcatSendGroupMessageResponseSchema>;
