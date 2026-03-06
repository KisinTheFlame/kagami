import { z } from "./base.js";

export const NapcatSendPrivateMessageRequestSchema = z.object({
  userId: z.string().min(1),
  message: z.string().min(1),
});

export type NapcatSendPrivateMessageRequest = z.infer<typeof NapcatSendPrivateMessageRequestSchema>;

export const NapcatSendPrivateMessageResponseSchema = z.object({
  messageId: z.number().int().positive(),
});

export type NapcatSendPrivateMessageResponse = z.infer<
  typeof NapcatSendPrivateMessageResponseSchema
>;

export const NapcatSendGroupMessageRequestSchema = z.object({
  groupId: z.string().min(1),
  message: z.string().min(1),
});

export type NapcatSendGroupMessageRequest = z.infer<typeof NapcatSendGroupMessageRequestSchema>;

export const NapcatSendGroupMessageResponseSchema = z.object({
  messageId: z.number().int().positive(),
});

export type NapcatSendGroupMessageResponse = z.infer<typeof NapcatSendGroupMessageResponseSchema>;
