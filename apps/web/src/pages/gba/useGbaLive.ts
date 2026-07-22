import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { buildApiUrl } from "@/lib/api";
import { queryKeys } from "@/lib/query";
import { gbaClient } from "@/lib/rpc";

/** 实况轮询间隔:页面聚焦时每秒一次(react-query 默认后台不轮询,失焦自动停,#541 PR3)。 */
const LIVE_POLL_INTERVAL_MS = 1000;

/** 运行状态轮询(聚焦时每秒)。 */
export function useGbaState() {
  return useQuery({
    queryKey: queryKeys.gba.state(),
    queryFn: () => gbaClient.consoleState({}),
    refetchInterval: LIVE_POLL_INTERVAL_MS,
    staleTime: 0,
  });
}

/**
 * 实况画面轮询(聚焦时每秒):/gba/console/screen 是 binary-raw PNG,裸 fetch 拿 blob 转
 * object URL 给 <img> 消费;404 = 未加载 ROM(无画面),返回 null 不算错误。
 * object URL 需手动回收——effect 在 URL 被替换 / 组件卸载时 revoke 上一帧,避免泄漏。
 */
export function useGbaScreen() {
  const query = useQuery({
    queryKey: queryKeys.gba.screen(),
    queryFn: async (): Promise<string | null> => {
      const response = await fetch(buildApiUrl("/gba/console/screen"), { cache: "no-store" });
      if (response.status === 404) {
        return null;
      }
      if (!response.ok) {
        throw new Error(`实况画面获取失败 (${response.status})`);
      }
      const blob = await response.blob();
      return URL.createObjectURL(blob);
    },
    refetchInterval: LIVE_POLL_INTERVAL_MS,
    staleTime: 0,
    retry: false,
  });

  const imageUrl = query.data ?? null;
  useEffect(() => {
    return () => {
      if (imageUrl) {
        URL.revokeObjectURL(imageUrl);
      }
    };
  }, [imageUrl]);

  return query;
}

export function useGbaRoms() {
  return useQuery({
    queryKey: queryKeys.gba.roms(),
    queryFn: () => gbaClient.listRoms({}),
  });
}

/** 领域拒绝 reason → 展示文案(服务端 { ok:false, reason } 不是 HTTP 错误)。 */
const GBA_REJECT_MESSAGES: Record<string, string> = {
  INVALID_NAME: "名称不合法(1-200 字符)",
  INVALID_ROM_SIZE: "文件大小不合法(GBA ROM 应 ≤32MB)",
  NOT_A_GBA_ROM: "不是合法的 GBA ROM(卡带头校验失败)",
  DUPLICATE_ROM: "内容重复:同一 ROM 已在库中",
  DUPLICATE_NAME: "名称重复:已有同名 ROM",
  ROM_LOADED: "该 ROM 正在游玩中,先让小镜换游戏再删",
  ROM_NOT_FOUND: "ROM 不存在(可能已被删除)",
  LOAD_IN_PROGRESS: "正在加载游戏,稍后再试",
};

function formatGbaReject(reason: string): string {
  return GBA_REJECT_MESSAGES[reason] ?? `操作被拒绝:${reason}`;
}

/** 上传:binary-envelope 裸字节 POST,ROM 名经 encodeURIComponent 走 header(中文名安全)。 */
export function useUploadRom() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ name, file }: { name: string; file: File }) => {
      const bytes = await file.arrayBuffer();
      const response = await fetch(buildApiUrl("/gba/roms"), {
        method: "POST",
        headers: {
          "content-type": "application/octet-stream",
          "x-gba-rom-name": encodeURIComponent(name),
        },
        body: bytes,
      });
      if (!response.ok) {
        throw new Error(`上传失败 (${response.status})`);
      }
      const result = (await response.json()) as { ok: true } | { ok: false; reason: string };
      if (!result.ok) {
        throw new Error(formatGbaReject(result.reason));
      }
      return result;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.gba.roms() });
    },
  });
}

export function useDeleteRom() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (romId: number) => {
      const result = await gbaClient.deleteRom({ romId });
      if (!result.ok) {
        throw new Error(formatGbaReject(result.reason));
      }
      return result;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.gba.roms() });
    },
  });
}
