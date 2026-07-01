import type {
  AmapGeocodeItem,
  AmapPoiResult,
  AmapRegeocode,
  AmapRoutePath,
  AmapTransitPlan,
  AmapWeatherResult,
  AmapDriveMode,
} from "./client/amap-client.js";

// === 高德地图 App 屏幕渲染 ===
// 重内容（POI 列表 / 路线 / 天气）走 append_message 进上下文尾部；这里只拼字段白名单，
// 末尾按 responseMaxChars 截断，绝不把完整高德 JSON 塞进上下文。

const MODE_LABEL: Record<AmapDriveMode, string> = {
  driving: "驾车",
  walking: "步行",
  bicycling: "骑行",
};

export function renderGeocode(address: string, items: AmapGeocodeItem[], maxChars: number): string {
  const lines = [`<amap_geocode address="${escapeAttr(address)}">`];
  if (items.length === 0) {
    lines.push("（没解析到坐标）");
  }
  items.forEach((it, i) => {
    const where = [it.province, it.city, it.district].filter(Boolean).join(" ");
    lines.push(`${i + 1}. ${it.formatted_address ?? (where || "(无地址)")}`);
    lines.push(
      `   坐标=${it.location ?? "?"} adcode=${it.adcode ?? "?"} citycode=${it.citycode ?? "?"}`,
    );
  });
  lines.push("</amap_geocode>");
  return truncate(lines.join("\n"), maxChars);
}

export function renderRegeocode(location: string, r: AmapRegeocode, maxChars: number): string {
  const lines = [`<amap_regeocode location="${escapeAttr(location)}">`];
  lines.push(r.formattedAddress ?? "(无地址)");
  const meta = [r.province, r.city, r.district, r.township].filter(Boolean).join(" ");
  if (meta) {
    lines.push(meta);
  }
  if (r.adcode) {
    lines.push(`adcode=${r.adcode}`);
  }
  lines.push("</amap_regeocode>");
  return truncate(lines.join("\n"), maxChars);
}

export function renderPoiList(
  tag: "amap_poi" | "amap_around",
  result: AmapPoiResult,
  attrs: string,
  maxChars: number,
): string {
  const lines = [`<${tag}${attrs} count="${result.count ?? "0"}">`];
  if (result.pois.length === 0) {
    lines.push("（没找到匹配的地点）");
  }
  result.pois.forEach((p, i) => {
    const head = `${i + 1}. ${p.name ?? "(无名)"}`;
    lines.push(head);
    const meta = [
      p.type,
      [p.cityname, p.adname].filter(Boolean).join(""),
      p.address,
      p.distance ? `${p.distance} 米` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    if (meta) {
      lines.push(`   ${meta}`);
    }
    if (p.location) {
      lines.push(`   坐标=${p.location}${p.id ? ` id=${p.id}` : ""}`);
    }
  });
  lines.push(`</${tag}>`);
  return truncate(lines.join("\n"), maxChars);
}

export function renderRoute(
  mode: AmapDriveMode,
  paths: AmapRoutePath[],
  maxSteps: number,
  maxChars: number,
): string {
  const lines = [`<amap_route mode="${MODE_LABEL[mode]}">`];
  if (paths.length === 0) {
    lines.push("（没规划出路线）");
  }
  paths.forEach((path, i) => {
    const head = [
      `方案 ${i + 1}`,
      path.distanceMeters ? `${path.distanceMeters} 米` : null,
      path.durationSeconds ? `约 ${formatDuration(path.durationSeconds)}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    lines.push(head);
    const shown = path.steps.slice(0, maxSteps);
    shown.forEach((step, idx) => lines.push(`  ${idx + 1}. ${step}`));
    if (path.steps.length > shown.length) {
      lines.push(`  …（还有 ${path.steps.length - shown.length} 步未展开）`);
    }
  });
  lines.push("</amap_route>");
  return truncate(lines.join("\n"), maxChars);
}

export function renderTransit(
  plans: AmapTransitPlan[],
  maxPlans: number,
  maxChars: number,
): string {
  const lines = ["<amap_transit>"];
  if (plans.length === 0) {
    lines.push("（没规划出公交方案）");
  }
  plans.slice(0, maxPlans).forEach((plan, i) => {
    const head = [
      `方案 ${i + 1}`,
      plan.durationSeconds ? `约 ${formatDuration(plan.durationSeconds)}` : null,
      plan.distanceMeters ? `${plan.distanceMeters} 米` : null,
      plan.walkingMeters ? `步行 ${plan.walkingMeters} 米` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    lines.push(head);
    if (plan.segments.length > 0) {
      lines.push(`  ${plan.segments.join(" → ")}`);
    }
  });
  lines.push("</amap_transit>");
  return truncate(lines.join("\n"), maxChars);
}

export function renderWeather(adcode: string, result: AmapWeatherResult, maxChars: number): string {
  const lines = [`<amap_weather adcode="${escapeAttr(adcode)}" kind="${result.kind}">`];
  if (result.kind === "base") {
    if (result.lives.length === 0) {
      lines.push("（没取到实况）");
    }
    for (const live of result.lives) {
      const place = [live.province, live.city].filter(Boolean).join("");
      lines.push(
        `${place}：${live.weather ?? "?"} ${live.temperature ?? "?"}℃ ` +
          `${live.winddirection ?? "?"}风${live.windpower ?? "?"}级 湿度${live.humidity ?? "?"}%`,
      );
      if (live.reporttime) {
        lines.push(`发布于 ${live.reporttime}`);
      }
    }
  } else {
    const forecast = result.forecasts[0];
    if (!forecast) {
      lines.push("（没取到预报）");
    } else {
      lines.push(`${forecast.city ?? ""} 预报（发布于 ${forecast.reporttime ?? "?"}）`);
      for (const cast of forecast.casts ?? []) {
        lines.push(
          `${cast.date ?? "?"} 周${cast.week ?? "?"}：白天${cast.dayweather ?? "?"} ` +
            `夜间${cast.nightweather ?? "?"}，${cast.nighttemp ?? "?"}~${cast.daytemp ?? "?"}℃，` +
            `${cast.daywind ?? "?"}风${cast.daypower ?? "?"}级`,
        );
      }
    }
  }
  lines.push("</amap_weather>");
  return truncate(lines.join("\n"), maxChars);
}

function formatDuration(seconds: string): string {
  const s = Number(seconds);
  if (!Number.isFinite(s)) {
    return `${seconds} 秒`;
  }
  const min = Math.round(s / 60);
  if (min < 60) {
    return `${min} 分钟`;
  }
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m > 0 ? `${h} 小时 ${m} 分钟` : `${h} 小时`;
}

function escapeAttr(value: string): string {
  return value.replace(/"/g, "'");
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, maxChars)}\n…（内容过长已截断）`;
}
