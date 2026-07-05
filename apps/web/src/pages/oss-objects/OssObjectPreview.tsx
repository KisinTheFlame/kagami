import { interpolatePath } from "@kagami/http/url";
import { getOssObjectContent } from "@kagami/oss-api/contract";
import { buildApiUrl } from "@/lib/api";

/**
 * 拼出对象字节透传 URL（经 gateway `/api/oss-object/:key/content` → kagami-oss）。路径取自契约
 * （interpolatePath 单一事实源），再由 buildApiUrl 加 `/api` 基址。响应带 nosniff + attachment，
 * `<img>` 子资源加载不受 attachment 影响、正常渲染；顶层导航才触发下载，杜绝存储型 XSS 内联执行。
 */
function ossObjectContentUrl(key: string): string {
  return buildApiUrl(interpolatePath(getOssObjectContent.path, { key }));
}

export function OssObjectPreview({ objectKey, mime }: { objectKey: string; mime: string }) {
  const url = ossObjectContentUrl(objectKey);

  if (mime.startsWith("image/")) {
    return (
      <img
        src={url}
        alt={objectKey}
        className="max-h-[420px] max-w-full rounded-none border object-contain"
      />
    );
  }

  return (
    <div className="rounded-none border p-4 text-sm text-muted-foreground">
      非图片类型（{mime}），无法内联预览。
      <a href={url} download className="ml-1 text-foreground underline">
        下载查看
      </a>
    </div>
  );
}
