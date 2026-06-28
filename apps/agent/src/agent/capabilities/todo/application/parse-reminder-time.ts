/**
 * 时间输入解析：拆成「时间点」与「时长」两个职责，别用一个 helper 兜两种类型。
 *
 * - `parseTimePoint`：`remindAt` / snooze `until` 用——给出一个绝对时刻 `Date`。
 *   收相对时长串（`"30m"`/`"2h"`/`"1d"`，相对 now）为主、ISO 绝对时间为辅。
 * - `parseDuration`：`repeatEvery` / snooze `forMinutes` 用——给出一个毫秒数。
 *   收相对时长串；也接受纯数字（按调用方约定的单位，这里只给毫秒解析）。
 *
 * 解析失败统一抛 `InvalidTimeError`（带可读 reason），由工具层转成结构化 INVALID_TIME。
 */

export class InvalidTimeError extends Error {
  public constructor(public readonly reason: string) {
    super(reason);
    this.name = "InvalidTimeError";
  }
}

const DURATION_PATTERN = /^(\d+)\s*(ms|s|m|h|d|w)$/i;

const UNIT_TO_MS: Record<string, number> = {
  ms: 1,
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
};

/**
 * 把相对时长串解析成毫秒。`"30m"` → 1_800_000。
 * 失败抛 InvalidTimeError。
 */
export function parseDuration(input: string): number {
  const trimmed = input.trim();
  const match = DURATION_PATTERN.exec(trimmed);
  if (!match) {
    throw new InvalidTimeError(
      `无法把 "${input}" 解析为时长，期望形如 "30m" / "2h" / "1d"（单位 ms/s/m/h/d/w）`,
    );
  }
  const amount = Number(match[1]);
  const unitMs = UNIT_TO_MS[match[2].toLowerCase()];
  const ms = amount * unitMs;
  if (!Number.isFinite(ms) || ms <= 0) {
    throw new InvalidTimeError(`时长 "${input}" 必须为正`);
  }
  return ms;
}

/**
 * 把时间输入解析成一个绝对时刻。
 * - 相对时长串（`"30m"`）→ now + 时长。
 * - ISO/可被 Date 解析的绝对时间串 → 该时刻。
 * 失败或解析出过去时刻（相对串天然不会）由调用方按需校验；这里只保证返回合法 Date。
 */
export function parseTimePoint(input: string, now: Date): Date {
  const trimmed = input.trim();
  if (DURATION_PATTERN.test(trimmed)) {
    return new Date(now.getTime() + parseDuration(trimmed));
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    throw new InvalidTimeError(
      `无法把 "${input}" 解析为时间，期望相对时长（"30m"）或 ISO 绝对时间`,
    );
  }
  return parsed;
}
