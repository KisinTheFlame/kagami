export type ImageAssetRecord = {
  resid: string;
  description: string;
};

export type UpsertImageAssetItem = {
  fileId: string;
  resid: string;
  description: string;
  mime: string | null;
};

/**
 * 内容寻址的图片资产登记：file_id（NapCat 图片的内容 MD5 + 扩展名）→ OSS resid + vision 描述。
 * 让同一张图全局只下载/描述/PUT 一次，命中即复用——resid 跨消息稳定、不膨胀。
 */
export interface ImageAssetDao {
  /** 按 file_id 查已存档的 resid + 描述；没有返回 null。 */
  findByFileId(fileId: string): Promise<ImageAssetRecord | null>;
  /** 登记一张图的 resid + 描述；file_id 冲突则更新（幂等）。 */
  upsert(item: UpsertImageAssetItem): Promise<void>;
}
