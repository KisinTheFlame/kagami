import { z } from "zod";

const NonEmptyStringSchema = z.string().min(1);

export type NapcatSendTextSegment = {
  type: "text";
  data: {
    text: string;
  };
};

export type NapcatSendAtSegment = {
  type: "at";
  data: {
    qq: string | "all";
  };
};

export type NapcatSendReplySegment = {
  type: "reply";
  data: {
    id: string;
  };
};

export type NapcatSendFaceSegment = {
  type: "face";
  data: {
    id: string;
  };
};

export type NapcatSendMFaceSegment = {
  type: "mface";
  data: {
    emoji_id: string;
    emoji_package_id: string;
    key: string;
    summary?: string;
  };
};

export type NapcatSendImageSegment = {
  type: "image";
  data: {
    file: string;
    summary?: string;
    sub_type?: string;
  };
};

export type NapcatSendFileSegment = {
  type: "file";
  data: {
    file: string;
    name?: string;
  };
};

export type NapcatSendVideoSegment = {
  type: "video";
  data: {
    file: string;
    name?: string;
    thumb?: string;
  };
};

export type NapcatSendRecordSegment = {
  type: "record";
  data: {
    file: string;
  };
};

export type NapcatSendJsonSegment = {
  type: "json";
  data: {
    data: string;
  };
};

export type NapcatSendDiceSegment = {
  type: "dice";
  data: Record<string, unknown>;
};

export type NapcatSendRPSSegment = {
  type: "rps";
  data: Record<string, unknown>;
};

export type NapcatSendMarkdownSegment = {
  type: "markdown";
  data: {
    content: string;
  };
};

export type NapcatSendCloudMusicSegment = {
  type: "music";
  data: {
    type: "qq" | "163" | "kugou" | "kuwo" | "migu";
    id: string;
  };
};

export type NapcatSendCustomMusicSegment = {
  type: "music";
  data: {
    type: "qq" | "163" | "kugou" | "kuwo" | "migu" | "custom";
    url: string;
    image: string;
    audio?: string;
    title?: string;
    singer?: string;
  };
};

export type NapcatSendNodeSegment = {
  type: "node";
  data:
    | (NapcatSendNodeMeta & {
        id: string;
      })
    | (NapcatSendNodeMeta & {
        content: NapcatSendMessageSegment[];
      });
};

type NapcatSendNodeMeta = {
  user_id?: string;
  nickname?: string;
  source?: string;
  news?: Array<{
    text: string;
  }>;
  summary?: string;
  prompt?: string;
  time?: string;
};

export type NapcatSendForwardSegment = {
  type: "forward";
  data: {
    id: string;
  };
};

export type NapcatSendContactSegment = {
  type: "contact";
  data: {
    type: "qq" | "group";
    id: string;
  };
};

export type NapcatSendMusicSegment = NapcatSendCloudMusicSegment | NapcatSendCustomMusicSegment;

export type NapcatSendMessageSegment =
  | NapcatSendTextSegment
  | NapcatSendAtSegment
  | NapcatSendReplySegment
  | NapcatSendFaceSegment
  | NapcatSendMFaceSegment
  | NapcatSendImageSegment
  | NapcatSendFileSegment
  | NapcatSendVideoSegment
  | NapcatSendRecordSegment
  | NapcatSendJsonSegment
  | NapcatSendDiceSegment
  | NapcatSendRPSSegment
  | NapcatSendMarkdownSegment
  | NapcatSendMusicSegment
  | NapcatSendNodeSegment
  | NapcatSendForwardSegment
  | NapcatSendContactSegment;

export const NapcatSendTextSegmentSchema: z.ZodType<NapcatSendTextSegment> = z.object({
  type: z.literal("text"),
  data: z.object({
    text: z.string(),
  }),
});

export const NapcatSendAtSegmentSchema: z.ZodType<NapcatSendAtSegment> = z.object({
  type: z.literal("at"),
  data: z.object({
    qq: z.union([NonEmptyStringSchema, z.literal("all")]),
  }),
});

export const NapcatSendReplySegmentSchema: z.ZodType<NapcatSendReplySegment> = z.object({
  type: z.literal("reply"),
  data: z.object({
    id: NonEmptyStringSchema,
  }),
});

export const NapcatSendFaceSegmentSchema: z.ZodType<NapcatSendFaceSegment> = z.object({
  type: z.literal("face"),
  data: z.object({
    id: NonEmptyStringSchema,
  }),
});

export const NapcatSendMFaceSegmentSchema: z.ZodType<NapcatSendMFaceSegment> = z.object({
  type: z.literal("mface"),
  data: z.object({
    emoji_id: NonEmptyStringSchema,
    emoji_package_id: NonEmptyStringSchema,
    key: NonEmptyStringSchema,
    summary: z.string().optional(),
  }),
});

export const NapcatSendImageSegmentSchema: z.ZodType<NapcatSendImageSegment> = z.object({
  type: z.literal("image"),
  data: z.object({
    file: NonEmptyStringSchema,
    summary: z.string().optional(),
    sub_type: z.string().optional(),
  }),
});

export const NapcatSendFileSegmentSchema: z.ZodType<NapcatSendFileSegment> = z.object({
  type: z.literal("file"),
  data: z.object({
    file: NonEmptyStringSchema,
    name: z.string().optional(),
  }),
});

export const NapcatSendVideoSegmentSchema: z.ZodType<NapcatSendVideoSegment> = z.object({
  type: z.literal("video"),
  data: z.object({
    file: NonEmptyStringSchema,
    name: z.string().optional(),
    thumb: z.string().optional(),
  }),
});

export const NapcatSendRecordSegmentSchema: z.ZodType<NapcatSendRecordSegment> = z.object({
  type: z.literal("record"),
  data: z.object({
    file: NonEmptyStringSchema,
  }),
});

export const NapcatSendJsonSegmentSchema: z.ZodType<NapcatSendJsonSegment> = z.object({
  type: z.literal("json"),
  data: z.object({
    data: z.string(),
  }),
});

const NapcatSendMagicDataSchema = z.record(z.string(), z.unknown());

export const NapcatSendDiceSegmentSchema: z.ZodType<NapcatSendDiceSegment> = z.object({
  type: z.literal("dice"),
  data: NapcatSendMagicDataSchema,
});

export const NapcatSendRPSSegmentSchema: z.ZodType<NapcatSendRPSSegment> = z.object({
  type: z.literal("rps"),
  data: NapcatSendMagicDataSchema,
});

export const NapcatSendMarkdownSegmentSchema: z.ZodType<NapcatSendMarkdownSegment> = z.object({
  type: z.literal("markdown"),
  data: z.object({
    content: z.string(),
  }),
});

export const NapcatSendCloudMusicSegmentSchema: z.ZodType<NapcatSendCloudMusicSegment> = z.object({
  type: z.literal("music"),
  data: z.object({
    type: z.enum(["qq", "163", "kugou", "kuwo", "migu"]),
    id: NonEmptyStringSchema,
  }),
});

export const NapcatSendCustomMusicSegmentSchema: z.ZodType<NapcatSendCustomMusicSegment> = z.object(
  {
    type: z.literal("music"),
    data: z.object({
      type: z.enum(["qq", "163", "kugou", "kuwo", "migu", "custom"]),
      url: NonEmptyStringSchema,
      image: NonEmptyStringSchema,
      audio: z.string().optional(),
      title: z.string().optional(),
      singer: z.string().optional(),
    }),
  },
);

export const NapcatSendMusicSegmentSchema: z.ZodType<NapcatSendMusicSegment> = z.union([
  NapcatSendCloudMusicSegmentSchema,
  NapcatSendCustomMusicSegmentSchema,
]);

const NapcatSendNodeMetaSchema = z.object({
  user_id: NonEmptyStringSchema.optional(),
  nickname: z.string().optional(),
  source: z.string().optional(),
  news: z
    .array(
      z.object({
        text: z.string(),
      }),
    )
    .optional(),
  summary: z.string().optional(),
  prompt: z.string().optional(),
  time: NonEmptyStringSchema.optional(),
});

export const NapcatSendNodeSegmentSchema: z.ZodType<NapcatSendNodeSegment> = z.lazy(() =>
  z.object({
    type: z.literal("node"),
    data: z.union([
      NapcatSendNodeMetaSchema.extend({
        id: NonEmptyStringSchema,
      }),
      NapcatSendNodeMetaSchema.extend({
        content: z.array(NapcatSendMessageSegmentSchema),
      }),
    ]),
  }),
);

export const NapcatSendForwardSegmentSchema: z.ZodType<NapcatSendForwardSegment> = z.object({
  type: z.literal("forward"),
  data: z.object({
    id: NonEmptyStringSchema,
  }),
});

export const NapcatSendContactSegmentSchema: z.ZodType<NapcatSendContactSegment> = z.object({
  type: z.literal("contact"),
  data: z.object({
    type: z.enum(["qq", "group"]),
    id: NonEmptyStringSchema,
  }),
});

export const NapcatSendMessageSegmentSchema: z.ZodType<NapcatSendMessageSegment> = z.lazy(() =>
  z.union([
    NapcatSendTextSegmentSchema,
    NapcatSendAtSegmentSchema,
    NapcatSendReplySegmentSchema,
    NapcatSendFaceSegmentSchema,
    NapcatSendMFaceSegmentSchema,
    NapcatSendImageSegmentSchema,
    NapcatSendFileSegmentSchema,
    NapcatSendVideoSegmentSchema,
    NapcatSendRecordSegmentSchema,
    NapcatSendJsonSegmentSchema,
    NapcatSendDiceSegmentSchema,
    NapcatSendRPSSegmentSchema,
    NapcatSendMarkdownSegmentSchema,
    NapcatSendMusicSegmentSchema,
    NapcatSendNodeSegmentSchema,
    NapcatSendForwardSegmentSchema,
    NapcatSendContactSegmentSchema,
  ]),
);

export type NapcatSendGroupSegment = NapcatSendTextSegment | NapcatSendImageSegment;

export const NapcatSendGroupSegmentSchema: z.ZodType<NapcatSendGroupSegment> = z.union([
  NapcatSendTextSegmentSchema,
  NapcatSendImageSegmentSchema,
]);

export type NapcatReceiveTextSegment = {
  type: "text";
  data: {
    text: string;
  };
};

export type NapcatReceiveAtSegment = {
  type: "at";
  data: {
    qq: string | "all";
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
      }
    | {
        summary: string;
        file: string;
        sub_type: string;
        url: string;
        key: string;
        emoji_id: string;
        emoji_package_id: number;
      };
};

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
  faceIndex?: number;
  faceText?: string;
  faceType?: number;
  packId?: string;
  stickerId?: string;
  sourceType?: number;
  stickerType?: number;
  resultId?: string;
  surpriseId?: string;
  randomType?: number;
  imageType?: number;
  pokeType?: number;
  spokeSummary?: string;
  doubleHit?: number;
  vaspokeId?: number;
  vaspokeName?: string;
  vaspokeMinver?: number;
  pokeStrength?: number;
  msgType?: number;
  faceBubbleCount?: number;
  oldVersionStr?: string;
  pokeFlag?: number;
  chainCount?: number;
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
    }),
    z.object({
      summary: z.string(),
      file: NonEmptyStringSchema,
      sub_type: NonEmptyStringSchema,
      url: NonEmptyStringSchema,
      key: NonEmptyStringSchema,
      emoji_id: NonEmptyStringSchema,
      emoji_package_id: z.number().int(),
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
    faceIndex: z.number().optional(),
    faceText: z.string().optional(),
    faceType: z.number().optional(),
    packId: z.string().optional(),
    stickerId: z.string().optional(),
    sourceType: z.number().optional(),
    stickerType: z.number().optional(),
    resultId: z.string().optional(),
    surpriseId: z.string().optional(),
    randomType: z.number().optional(),
    imageType: z.number().optional(),
    pokeType: z.number().optional(),
    spokeSummary: z.string().optional(),
    doubleHit: z.number().optional(),
    vaspokeId: z.number().optional(),
    vaspokeName: z.string().optional(),
    vaspokeMinver: z.number().optional(),
    pokeStrength: z.number().optional(),
    msgType: z.number().optional(),
    faceBubbleCount: z.number().optional(),
    oldVersionStr: z.string().optional(),
    pokeFlag: z.number().optional(),
    chainCount: z.number().optional(),
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
