import type { JsonValue } from "@kagami/shared";

const SEGMENT_LABELS: Record<string, string> = {
  dice: "[dice]",
  face: "[face]",
  file: "[file]",
  forward: "[forward]",
  image: "[image]",
  json: "[json]",
  markdown: "[markdown]",
  poke: "[poke]",
  record: "[record]",
  reply: "[reply]",
  rps: "[rps]",
  video: "[video]",
};

export function renderNapcatMessagePreview(message: JsonValue): string {
  if (!Array.isArray(message)) {
    return safeStringify(message);
  }

  try {
    const rendered = message.map(renderSegmentPreview).join("");
    return rendered.length > 0 ? rendered : safeStringify(message);
  } catch {
    return safeStringify(message);
  }
}

export function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function renderSegmentPreview(segment: JsonValue): string {
  if (!isRecord(segment)) {
    return safeStringify(segment);
  }

  const type = typeof segment.type === "string" ? segment.type : "";
  const data = isRecord(segment.data) ? segment.data : null;

  if (type === "text") {
    return typeof data?.text === "string" ? data.text : "[text]";
  }

  if (type === "at") {
    const qq = data?.qq;
    if (typeof qq === "string" || typeof qq === "number") {
      return `@${String(qq)}`;
    }
    return "@unknown";
  }

  if (type.length > 0) {
    return SEGMENT_LABELS[type] ?? `[${type}]`;
  }

  return "[segment]";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
