import { z } from "zod";

/**
 * NapCat（OneBot）**入站**消息段的 wire 词汇 —— napcat 服务对 agent 暴露的消息结构单一事实源。
 *
 * 只含 receive 段：agent 侧要走这些段做 @提及检测（detectBotMentioned）与预览渲染，故它们必须
 * 跨进程、typed 上线。**出站（send）段不在此**——出站发送的 wire 入参只是一个纯文本 message
 * 字符串（reply / at / image 的拼装是 napcat 网关内部实现细节，不进契约）。
 *
 * 忠实迁移自原 `apps/agent/src/napcat/domain/napcat-segment.ts` 的 receive 部分（issue #347 拆分）；
 * 割接（#350）后 agent 从这里 import、删除本地副本。
 */

const NonEmptyStringSchema = z.string().min(1);

export type NapcatReceiveTextSegment = {
  type: "text";
  data: {
    text: string;
  };
};

export type NapcatReceiveAtSegment = {
  type: "at";
  data: {
    qq: string; // "all" 表示 @全体成员
    name?: string;
  };
};

export type NapcatReceiveImageSegment = {
  type: "image";
  data:
    | {
        summary: string;
        file: string;
        sub_type: number;
        url: string;
        file_size: string;
        // OSS 资产 key（resid）。入站时由图片分析器存档原图后回填，持久化进消息记录，
        // 渲染成 [图片: 描述, resid: res-N]，让 Agent 能引用原图。NapCat 原始 payload 里没有。
        resid?: string;
      }
    | {
        summary: string;
        file: string;
        sub_type: string;
        url: string;
        key: string;
        emoji_id: string;
        emoji_package_id: number;
        resid?: string;
      };
};

export function isNapcatReceiveImageSegment(
  segment: NapcatReceiveMessageSegment,
): segment is NapcatReceiveImageSegment {
  return segment.type === "image";
}

export type NapcatReceiveFileSegment = {
  type: "file";
  data: {
    file: string;
    file_id: string;
    file_size: string;
  };
};

export type NapcatReceivePokeSegment = {
  type: "poke";
  data: {
    type: string;
    id: string;
  };
};

export type NapcatReceiveDiceSegment = {
  type: "dice";
  data: {
    result: string;
  };
};

export type NapcatReceiveRPSSegment = {
  type: "rps";
  data: {
    result: string;
  };
};

type NapcatReceiveFaceRaw = {
  faceIndex?: number | null;
  faceText?: string | null;
  faceType?: number | null;
  packId?: string | null;
  stickerId?: string | null;
  sourceType?: number | null;
  stickerType?: number | null;
  resultId?: string | null;
  surpriseId?: string | null;
  randomType?: number | null;
  imageType?: number | null;
  pokeType?: number | null;
  spokeSummary?: string | null;
  doubleHit?: number | null;
  vaspokeId?: number | null;
  vaspokeName?: string | null;
  vaspokeMinver?: number | null;
  pokeStrength?: number | null;
  msgType?: number | null;
  faceBubbleCount?: number | null;
  oldVersionStr?: string | null;
  pokeFlag?: number | null;
  chainCount?: number | null;
};

export type NapcatReceiveFaceSegment = {
  type: "face";
  data: {
    id: string;
    raw: NapcatReceiveFaceRaw;
    resultId: string | null;
    chainCount: number | null;
  };
};

export type NapcatReceiveReplySegment = {
  type: "reply";
  data: {
    id: string;
    senderNickname?: string;
    senderUserId?: string;
    messagePreview?: string;
  };
};

export type NapcatReceiveVideoSegment = {
  type: "video";
  data: {
    file: string;
    url: string;
    file_size: string;
  };
};

export type NapcatReceiveRecordSegment = {
  type: "record";
  data: {
    file: string;
    file_size: string;
  };
};

export type NapcatReceiveForwardSegment = {
  type: "forward";
  data: {
    id: string;
    content?: NapcatReceiveMessageSegment[];
  };
};

export type NapcatReceiveJsonSegment = {
  type: "json";
  data: {
    data: string;
  };
};

export type NapcatReceiveMarkdownSegment = {
  type: "markdown";
  data: {
    content: string;
  };
};

export type NapcatReceiveMessageSegment =
  | NapcatReceiveTextSegment
  | NapcatReceiveAtSegment
  | NapcatReceiveImageSegment
  | NapcatReceiveFileSegment
  | NapcatReceivePokeSegment
  | NapcatReceiveDiceSegment
  | NapcatReceiveRPSSegment
  | NapcatReceiveFaceSegment
  | NapcatReceiveReplySegment
  | NapcatReceiveVideoSegment
  | NapcatReceiveRecordSegment
  | NapcatReceiveForwardSegment
  | NapcatReceiveJsonSegment
  | NapcatReceiveMarkdownSegment;

export const NapcatReceiveTextSegmentSchema: z.ZodType<NapcatReceiveTextSegment> = z.object({
  type: z.literal("text"),
  data: z.object({
    text: z.string(),
  }),
});

export const NapcatReceiveAtSegmentSchema: z.ZodType<NapcatReceiveAtSegment> = z.object({
  type: z.literal("at"),
  data: z.object({
    qq: z.union([NonEmptyStringSchema, z.literal("all")]),
    name: z.string().optional(),
  }),
});

export const NapcatReceiveImageSegmentSchema: z.ZodType<NapcatReceiveImageSegment> = z.object({
  type: z.literal("image"),
  data: z.union([
    z.object({
      summary: z.string(),
      file: NonEmptyStringSchema,
      sub_type: z.number().int(),
      url: NonEmptyStringSchema,
      file_size: NonEmptyStringSchema,
      resid: z.string().optional(),
    }),
    z.object({
      summary: z.string(),
      file: NonEmptyStringSchema,
      sub_type: NonEmptyStringSchema,
      url: NonEmptyStringSchema,
      key: NonEmptyStringSchema,
      emoji_id: NonEmptyStringSchema,
      emoji_package_id: z.number().int(),
      resid: z.string().optional(),
    }),
  ]),
});

export const NapcatReceiveFileSegmentSchema: z.ZodType<NapcatReceiveFileSegment> = z.object({
  type: z.literal("file"),
  data: z.object({
    file: NonEmptyStringSchema,
    file_id: NonEmptyStringSchema,
    file_size: NonEmptyStringSchema,
  }),
});

export const NapcatReceivePokeSegmentSchema: z.ZodType<NapcatReceivePokeSegment> = z.object({
  type: z.literal("poke"),
  data: z.object({
    type: NonEmptyStringSchema,
    id: NonEmptyStringSchema,
  }),
});

export const NapcatReceiveDiceSegmentSchema: z.ZodType<NapcatReceiveDiceSegment> = z.object({
  type: z.literal("dice"),
  data: z.object({
    result: z.string(),
  }),
});

export const NapcatReceiveRPSSegmentSchema: z.ZodType<NapcatReceiveRPSSegment> = z.object({
  type: z.literal("rps"),
  data: z.object({
    result: z.string(),
  }),
});

const NapcatReceiveFaceRawSchema: z.ZodType<NapcatReceiveFaceRaw> = z
  .object({
    faceIndex: z.number().nullable().optional(),
    faceText: z.string().nullable().optional(),
    faceType: z.number().nullable().optional(),
    packId: z.string().nullable().optional(),
    stickerId: z.string().nullable().optional(),
    sourceType: z.number().nullable().optional(),
    stickerType: z.number().nullable().optional(),
    resultId: z.string().nullable().optional(),
    surpriseId: z.string().nullable().optional(),
    randomType: z.number().nullable().optional(),
    imageType: z.number().nullable().optional(),
    pokeType: z.number().nullable().optional(),
    spokeSummary: z.string().nullable().optional(),
    doubleHit: z.number().nullable().optional(),
    vaspokeId: z.number().nullable().optional(),
    vaspokeName: z.string().nullable().optional(),
    vaspokeMinver: z.number().nullable().optional(),
    pokeStrength: z.number().nullable().optional(),
    msgType: z.number().nullable().optional(),
    faceBubbleCount: z.number().nullable().optional(),
    oldVersionStr: z.string().nullable().optional(),
    pokeFlag: z.number().nullable().optional(),
    chainCount: z.number().nullable().optional(),
  })
  .passthrough();

export const NapcatReceiveFaceSegmentSchema: z.ZodType<NapcatReceiveFaceSegment> = z.object({
  type: z.literal("face"),
  data: z.object({
    id: NonEmptyStringSchema,
    raw: NapcatReceiveFaceRawSchema,
    resultId: z.string().nullable(),
    chainCount: z.number().nullable(),
  }),
});

export const NapcatReceiveReplySegmentSchema: z.ZodType<NapcatReceiveReplySegment> = z.object({
  type: z.literal("reply"),
  data: z.object({
    id: NonEmptyStringSchema,
    senderNickname: z.string().optional(),
    senderUserId: z.string().optional(),
    messagePreview: z.string().optional(),
  }),
});

export const NapcatReceiveVideoSegmentSchema: z.ZodType<NapcatReceiveVideoSegment> = z.object({
  type: z.literal("video"),
  data: z.object({
    file: NonEmptyStringSchema,
    url: NonEmptyStringSchema,
    file_size: NonEmptyStringSchema,
  }),
});

export const NapcatReceiveRecordSegmentSchema: z.ZodType<NapcatReceiveRecordSegment> = z.object({
  type: z.literal("record"),
  data: z.object({
    file: NonEmptyStringSchema,
    file_size: NonEmptyStringSchema,
  }),
});

export const NapcatReceiveForwardSegmentSchema: z.ZodType<NapcatReceiveForwardSegment> = z.lazy(
  () =>
    z.object({
      type: z.literal("forward"),
      data: z.object({
        id: NonEmptyStringSchema,
        content: z.array(NapcatReceiveMessageSegmentSchema).optional(),
      }),
    }),
);

export const NapcatReceiveJsonSegmentSchema: z.ZodType<NapcatReceiveJsonSegment> = z.object({
  type: z.literal("json"),
  data: z.object({
    data: z.string(),
  }),
});

export const NapcatReceiveMarkdownSegmentSchema: z.ZodType<NapcatReceiveMarkdownSegment> = z.object(
  {
    type: z.literal("markdown"),
    data: z.object({
      content: z.string(),
    }),
  },
);

export const NapcatReceiveMessageSegmentSchema: z.ZodType<NapcatReceiveMessageSegment> = z.lazy(
  () =>
    z.union([
      NapcatReceiveTextSegmentSchema,
      NapcatReceiveAtSegmentSchema,
      NapcatReceiveImageSegmentSchema,
      NapcatReceiveFileSegmentSchema,
      NapcatReceivePokeSegmentSchema,
      NapcatReceiveDiceSegmentSchema,
      NapcatReceiveRPSSegmentSchema,
      NapcatReceiveFaceSegmentSchema,
      NapcatReceiveReplySegmentSchema,
      NapcatReceiveVideoSegmentSchema,
      NapcatReceiveRecordSegmentSchema,
      NapcatReceiveForwardSegmentSchema,
      NapcatReceiveJsonSegmentSchema,
      NapcatReceiveMarkdownSegmentSchema,
    ]),
);

export const MessageSegmentsSchema = z.array(NapcatReceiveMessageSegmentSchema);
