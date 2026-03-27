import { z } from "zod";
import { parseOptionalStringInput } from "./base.js";

export const AuthUsageTrendRangeSchema = z.enum(["24h", "7d"]);

export type AuthUsageTrendRange = z.infer<typeof AuthUsageTrendRangeSchema>;

export const AuthUsageTrendWindowSchema = z.enum(["five_hour", "seven_day"]);

export type AuthUsageTrendWindow = z.infer<typeof AuthUsageTrendWindowSchema>;

export const AuthUsageTrendPointSchema = z
  .object({
    capturedAt: z.string().datetime(),
    remainingPercent: z.number(),
  })
  .strict();

export type AuthUsageTrendPoint = z.infer<typeof AuthUsageTrendPointSchema>;

export const AuthUsageTrendSeriesSchema = z
  .object({
    windowKey: AuthUsageTrendWindowSchema,
    label: z.string().min(1),
    points: z.array(AuthUsageTrendPointSchema),
  })
  .strict();

export type AuthUsageTrendSeries = z.infer<typeof AuthUsageTrendSeriesSchema>;

export const AuthUsageTrendResponseSchema = z
  .object({
    range: AuthUsageTrendRangeSchema,
    series: z.array(AuthUsageTrendSeriesSchema),
  })
  .strict();

export type AuthUsageTrendResponse = z.infer<typeof AuthUsageTrendResponseSchema>;

export const AuthUsageTrendQuerySchema = z
  .object({
    range: z
      .preprocess(parseOptionalStringInput, AuthUsageTrendRangeSchema.optional())
      .default("24h"),
  })
  .strict();

export type AuthUsageTrendQuery = z.infer<typeof AuthUsageTrendQuerySchema>;
