import { z } from "zod";
import { BizError } from "../../../../common/errors/biz-error.js";

const STORY_MARKDOWN_FIELD_LABELS = {
  time: "时间",
  scene: "场景",
  people: "人物",
  impact: "影响",
  cause: "起因",
  process: "经过",
  result: "结果",
} as const;

export const StoryContentSchema = z.object({
  title: z.string().trim().min(1),
  time: z.string().trim().min(1),
  scene: z.string().trim(),
  people: z.array(z.string().trim().min(1)).default([]),
  cause: z.string().trim().min(1),
  process: z.array(z.string().trim().min(1)).min(1),
  result: z.string().trim().min(1),
  impact: z.string().trim().min(1),
});

export type StoryContent = z.infer<typeof StoryContentSchema>;

export type StoryMarkdownValidationResult =
  | {
      ok: true;
      story: StoryContent;
      normalizedMarkdown: string;
    }
  | {
      ok: false;
      errors: string[];
    };

export function formatStoryMarkdown(story: StoryContent): string {
  const normalized = StoryContentSchema.parse(story);
  return [
    `# ${normalized.title}`,
    `- ${STORY_MARKDOWN_FIELD_LABELS.time}：${normalized.time}`,
    `- ${STORY_MARKDOWN_FIELD_LABELS.scene}：${normalized.scene}`,
    `- ${STORY_MARKDOWN_FIELD_LABELS.people}：${normalized.people.join("、")}`,
    `- ${STORY_MARKDOWN_FIELD_LABELS.impact}：${normalized.impact}`,
    "",
    `${STORY_MARKDOWN_FIELD_LABELS.cause}：${normalized.cause}`,
    `${STORY_MARKDOWN_FIELD_LABELS.process}：`,
    ...normalized.process.map((step, index) => `${index + 1}. ${step}`),
    `${STORY_MARKDOWN_FIELD_LABELS.result}：${normalized.result}`,
  ].join("\n");
}

export function validateStoryMarkdown(markdown: string): StoryMarkdownValidationResult {
  const errors: string[] = [];
  const normalizedInput = markdown.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trimEnd();
  const lines = normalizedInput.split("\n");

  while (lines.length > 0 && lines[lines.length - 1]?.trim() === "") {
    lines.pop();
  }

  if (lines.length === 0) {
    return {
      ok: false,
      errors: ["记忆 Markdown 不能为空。"],
    };
  }

  const titleMatch = lines[0]?.match(/^# (.+)$/);
  if (!titleMatch) {
    errors.push("第一行必须是 `# <标题>`。");
  }
  const title = titleMatch?.[1]?.trim() ?? "";
  if (titleMatch && title.length === 0) {
    errors.push("标题不能为空。");
  }

  const metadataSpecs = [
    {
      lineIndex: 1,
      prefix: `- ${STORY_MARKDOWN_FIELD_LABELS.time}：`,
      key: "time" as const,
      required: true,
    },
    {
      lineIndex: 2,
      prefix: `- ${STORY_MARKDOWN_FIELD_LABELS.scene}：`,
      key: "scene" as const,
      required: false,
    },
    {
      lineIndex: 3,
      prefix: `- ${STORY_MARKDOWN_FIELD_LABELS.people}：`,
      key: "people" as const,
      required: false,
    },
    {
      lineIndex: 4,
      prefix: `- ${STORY_MARKDOWN_FIELD_LABELS.impact}：`,
      key: "impact" as const,
      required: true,
    },
  ];

  const metadataValues: Record<"time" | "scene" | "people" | "impact", string> = {
    time: "",
    scene: "",
    people: "",
    impact: "",
  };

  for (const spec of metadataSpecs) {
    const line = lines[spec.lineIndex];
    if (typeof line !== "string") {
      errors.push(`缺少 \`${spec.prefix}\` 行。`);
      continue;
    }

    if (!line.startsWith(spec.prefix)) {
      errors.push(`第 ${spec.lineIndex + 1} 行必须是 \`${spec.prefix}<内容>\`。`);
      continue;
    }

    const value = line.slice(spec.prefix.length).trim();
    if (spec.required && value.length === 0) {
      errors.push(`“${STORY_MARKDOWN_FIELD_LABELS[spec.key]}：”不能为空。`);
    }

    metadataValues[spec.key] = value;
  }

  if (lines[5] !== "") {
    errors.push("元数据后必须保留一个空行。");
  }

  const causeLine = lines[6];
  if (typeof causeLine !== "string") {
    errors.push("缺少 `起因：` 行。");
  } else if (!causeLine.startsWith(`${STORY_MARKDOWN_FIELD_LABELS.cause}：`)) {
    errors.push("第 7 行必须是 `起因：<内容>`。");
  }
  const cause = causeLine?.startsWith(`${STORY_MARKDOWN_FIELD_LABELS.cause}：`)
    ? causeLine.slice(`${STORY_MARKDOWN_FIELD_LABELS.cause}：`.length).trim()
    : "";
  if (causeLine?.startsWith(`${STORY_MARKDOWN_FIELD_LABELS.cause}：`) && cause.length === 0) {
    errors.push("“起因：”不能为空。");
  }

  const processHeaderLine = lines[7];
  if (processHeaderLine !== `${STORY_MARKDOWN_FIELD_LABELS.process}：`) {
    errors.push("第 8 行必须是 `经过：`。");
  }

  let resultLineIndex = -1;
  for (let index = 8; index < lines.length; index += 1) {
    if (lines[index]?.startsWith(`${STORY_MARKDOWN_FIELD_LABELS.result}：`)) {
      resultLineIndex = index;
      break;
    }
  }

  if (resultLineIndex === -1) {
    errors.push("缺少 `结果：` 行。");
  }

  const processLines = resultLineIndex === -1 ? lines.slice(8) : lines.slice(8, resultLineIndex);
  if (processLines.length === 0) {
    errors.push("“经过：”后至少需要 1 条有序列表项。");
  }

  const process: string[] = [];
  for (const [offset, line] of processLines.entries()) {
    if (line.trim().length === 0) {
      errors.push("“经过：”列表中不允许空行。");
      continue;
    }

    const expectedNumber = offset + 1;
    const match = line.match(/^(\d+)\. (.+)$/);
    if (!match) {
      errors.push(`“经过：”后的第 ${expectedNumber} 行必须是 \`${expectedNumber}. <内容>\`。`);
      continue;
    }

    const actualNumber = Number(match[1]);
    if (actualNumber !== expectedNumber) {
      errors.push(
        `“经过：”列表编号必须从 1 连续递增；期望 ${expectedNumber}，实际 ${actualNumber}。`,
      );
      continue;
    }

    const value = match[2]?.trim() ?? "";
    if (value.length === 0) {
      errors.push(`“经过：”后的第 ${expectedNumber} 条不能为空。`);
      continue;
    }

    process.push(value);
  }

  const resultLine = resultLineIndex === -1 ? undefined : lines[resultLineIndex];
  const result = resultLine?.startsWith(`${STORY_MARKDOWN_FIELD_LABELS.result}：`)
    ? resultLine.slice(`${STORY_MARKDOWN_FIELD_LABELS.result}：`.length).trim()
    : "";
  if (resultLine && result.length === 0) {
    errors.push("“结果：”不能为空。");
  }

  if (resultLineIndex !== -1) {
    const extraLines = lines.slice(resultLineIndex + 1).filter(line => line.trim().length > 0);
    if (extraLines.length > 0) {
      errors.push(`出现未允许的额外内容：${extraLines.map(line => `\`${line}\``).join("、")}。`);
    }
  }

  if (errors.length > 0) {
    return {
      ok: false,
      errors,
    };
  }

  const people =
    metadataValues.people.length === 0
      ? []
      : metadataValues.people
          .split("、")
          .map(value => value.trim())
          .filter(value => value.length > 0);

  const story = StoryContentSchema.parse({
    title,
    time: metadataValues.time,
    scene: metadataValues.scene,
    people,
    cause,
    process,
    result,
    impact: metadataValues.impact,
  });

  return {
    ok: true,
    story,
    normalizedMarkdown: formatStoryMarkdown(story),
  };
}

export function parseStoryMarkdown(markdown: string): StoryContent {
  const result = validateStoryMarkdown(markdown);
  if (!result.ok) {
    throw new BizError({
      message: `Invalid story markdown: ${result.errors.join("；")}`,
      statusCode: 400,
    });
  }

  return result.story;
}
