import { BizError } from "@kagami/kernel/errors/biz-error";

/**
 * 校验并归一化一个高德坐标串 `"经度,纬度"`（GCJ-02，经度在前）。
 *
 * 高德要求经纬度最多 6 位小数；这里做范围校验并把小数截到 6 位。范围校验能挡住纬度 >90 的
 * 明显反序（如把 `lat,lng` 写反且真实经度 >90），但两个分量都 ≤90 时无法判定是否反序——这是
 * 坐标本身的歧义，非本函数能消除，只作尽力而为的一道闸。非法输入抛 BizError（基类会 catch
 * 成结构化错误进 tool_result）。
 */
export function normalizeLngLat(value: string, field = "location"): string {
  const trimmed = (value ?? "").trim();
  const parts = trimmed.split(",");
  if (parts.length !== 2) {
    throw new BizError({
      message: `${field} 必须是 "经度,纬度" 形式（GCJ-02，经度在前），逗号分隔`,
      meta: { reason: "AMAP_INVALID_COORD", field, value: trimmed },
    });
  }
  const lng = Number(parts[0]);
  const lat = Number(parts[1]);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
    throw new BizError({
      message: `${field} 的经纬度必须是数字`,
      meta: { reason: "AMAP_INVALID_COORD", field, value: trimmed },
    });
  }
  if (lng < -180 || lng > 180 || lat < -90 || lat > 90) {
    throw new BizError({
      message: `${field} 越界（经度需在 [-180,180]、纬度在 [-90,90]，注意经度在前别写反）`,
      meta: { reason: "AMAP_INVALID_COORD", field, lng, lat },
    });
  }
  return `${round6(lng)},${round6(lat)}`;
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
