import {
  createPaginatedResponseSchema,
  JsonRecordSchema,
  PaginationQuerySchema,
  parseOptionalStringInput,
  z,
} from "./base.js";

export const NapcatEventListQuerySchema = PaginationQuerySchema.extend({
  postType: z.preprocess(parseOptionalStringInput, z.string().min(1).optional()),
  messageType: z.preprocess(parseOptionalStringInput, z.string().min(1).optional()),
  userId: z.preprocess(parseOptionalStringInput, z.string().min(1).optional()),
  keyword: z.preprocess(parseOptionalStringInput, z.string().min(1).optional()),
  startAt: z.preprocess(parseOptionalStringInput, z.string().datetime().optional()),
  endAt: z.preprocess(parseOptionalStringInput, z.string().datetime().optional()),
}).superRefine((value, ctx) => {
  if (!value.startAt || !value.endAt) {
    return;
  }

  if (new Date(value.startAt).getTime() > new Date(value.endAt).getTime()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["startAt"],
      message: "startAt must be less than or equal to endAt",
    });
  }
});

export type NapcatEventListQuery = z.infer<typeof NapcatEventListQuerySchema>;

export const NapcatEventItemSchema = z.object({
  id: z.number().int().positive(),
  postType: z.string().min(1),
  messageType: z.string().min(1).nullable(),
  subType: z.string().min(1).nullable(),
  userId: z.string().min(1).nullable(),
  groupId: z.string().min(1).nullable(),
  rawMessage: z.string().min(1).nullable(),
  eventTime: z.string().datetime().nullable(),
  payload: JsonRecordSchema,
  createdAt: z.string().datetime(),
});

export type NapcatEventItem = z.infer<typeof NapcatEventItemSchema>;

export const NapcatEventListResponseSchema = createPaginatedResponseSchema(NapcatEventItemSchema);

export type NapcatEventListResponse = z.infer<typeof NapcatEventListResponseSchema>;
