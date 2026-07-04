import { z } from "zod";
import {
  createPaginatedResponseSchema,
  PaginationQuerySchema,
  parseOptionalStringInput,
} from "@kagami/http/wire";

export const TodoItemStatusSchema = z.enum(["pending", "completed", "removed"]);

export type TodoItemStatus = z.infer<typeof TodoItemStatusSchema>;

export const TodoListQuerySchema = PaginationQuerySchema.extend({
  status: z.preprocess(parseOptionalStringInput, TodoItemStatusSchema.optional()),
});

export type TodoListQuery = z.infer<typeof TodoListQuerySchema>;

export const TodoItemSchema = z.object({
  id: z.number().int().positive(),
  title: z.string(),
  note: z.string().nullable(),
  status: TodoItemStatusSchema,
  remindAt: z.string().datetime().nullable(),
  repeatEveryMs: z.number().int().positive().nullable(),
  snoozedUntil: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
});

export type TodoItem = z.infer<typeof TodoItemSchema>;

export const TodoListResponseSchema = createPaginatedResponseSchema(TodoItemSchema);

export type TodoListResponse = z.infer<typeof TodoListResponseSchema>;
