import {
  StoryReindexRequestSchema,
  StoryReindexResponseSchema,
} from "@kagami/shared/schemas/story";
import { describe, expect, it } from "vitest";

describe("story schemas", () => {
  it("should parse story reindex request defaults", () => {
    const result = StoryReindexRequestSchema.parse({});

    expect(result).toEqual({
      mode: "outdated",
      pageSize: 50,
    });
  });

  it("should parse story reindex response", () => {
    const result = StoryReindexResponseSchema.parse({
      mode: "all",
      totalStories: 10,
      targetedStories: 10,
      reindexedStories: 9,
      skippedStories: 0,
      failedStories: 1,
      failures: [
        {
          storyId: "story-1",
          message: "boom",
        },
      ],
    });

    expect(result.failures).toHaveLength(1);
  });
});
