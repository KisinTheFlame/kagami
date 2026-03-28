import type {
  AuthUsageTrendPoint,
  AuthUsageTrendResponse,
  AuthUsageTrendWindow,
} from "@kagami/shared";
import type { AuthUsageSnapshotDao } from "../dao/auth-usage-snapshot.dao.js";
import type {
  AuthUsageTrendQueryService,
  QueryAuthUsageTrendInput,
} from "./auth-usage-trend-query.service.js";

type DefaultAuthUsageTrendQueryServiceDeps = {
  authUsageSnapshotDao: AuthUsageSnapshotDao;
};

const WINDOW_ORDER: AuthUsageTrendWindow[] = ["five_hour", "seven_day"];
const WINDOW_LABELS: Record<AuthUsageTrendWindow, string> = {
  five_hour: "5 小时",
  seven_day: "7 天",
};

export class DefaultAuthUsageTrendQueryService implements AuthUsageTrendQueryService {
  private readonly authUsageSnapshotDao: AuthUsageSnapshotDao;

  public constructor({ authUsageSnapshotDao }: DefaultAuthUsageTrendQueryServiceDeps) {
    this.authUsageSnapshotDao = authUsageSnapshotDao;
  }

  public async query(input: QueryAuthUsageTrendInput): Promise<AuthUsageTrendResponse> {
    if (!input.accountId) {
      return createEmptyResponse(input.range);
    }

    const items = await this.authUsageSnapshotDao.listByRange({
      provider: input.provider,
      accountId: input.accountId,
      range: input.range,
    });
    const pointsByWindow = new Map<AuthUsageTrendWindow, AuthUsageTrendPoint[]>(
      WINDOW_ORDER.map(windowKey => [windowKey, []]),
    );

    for (const item of items) {
      const list = pointsByWindow.get(item.windowKey);
      if (!list) {
        continue;
      }

      list.push({
        capturedAt: item.capturedAt.toISOString(),
        remainingPercent: item.remainingPercent,
      });
    }

    return {
      range: input.range,
      series: WINDOW_ORDER.map(windowKey => ({
        windowKey,
        label: WINDOW_LABELS[windowKey],
        points:
          input.range === "7d"
            ? downsampleHourly(pointsByWindow.get(windowKey) ?? [])
            : (pointsByWindow.get(windowKey) ?? []),
      })),
    };
  }
}

function createEmptyResponse(range: QueryAuthUsageTrendInput["range"]): AuthUsageTrendResponse {
  return {
    range,
    series: WINDOW_ORDER.map(windowKey => ({
      windowKey,
      label: WINDOW_LABELS[windowKey],
      points: [],
    })),
  };
}

function downsampleHourly(points: AuthUsageTrendPoint[]): AuthUsageTrendPoint[] {
  const buckets = new Map<number, AuthUsageTrendPoint>();

  for (const point of points) {
    const capturedAt = new Date(point.capturedAt);
    if (Number.isNaN(capturedAt.getTime())) {
      continue;
    }

    const bucketKey = Math.floor(capturedAt.getTime() / (60 * 60 * 1000));
    buckets.set(bucketKey, point);
  }

  return [...buckets.entries()].sort((left, right) => left[0] - right[0]).map(([, point]) => point);
}
