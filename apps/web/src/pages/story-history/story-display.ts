import { type StoryMatchedKind } from "@kagami/shared/schemas/story";

const STORY_MATCHED_KIND_LABELS: Record<StoryMatchedKind, string> = {
  overview: "概览",
  people_scene: "人物/场景",
  process: "经过",
};

export function formatStoryScore(score: number | null): string {
  return score === null ? "—" : score.toFixed(3);
}

export function formatStoryMatchedKinds(kinds: StoryMatchedKind[]): string[] {
  return kinds.map(kind => STORY_MATCHED_KIND_LABELS[kind]);
}
