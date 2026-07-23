import { renderServerStaticTemplate } from "@kagami/kernel/runtime/read-static-text";

export function createVisionSystemPrompt(
  { tileCount }: { tileCount: number } = { tileCount: 1 },
): string {
  return renderServerStaticTemplate(import.meta.url, "prompts/vision-system.hbs", {
    isTiled: tileCount > 1,
    tileCount,
  }).trim();
}
