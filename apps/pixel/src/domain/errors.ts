/**
 * 领域拒绝：无效颜色 / 越界坐标 / 无画布。这些不是服务故障，是 LLM 该纠正的输入错误——
 * handler 捕获后带回 { ok:false, reason } 的 CanvasResponse（200），不当 HTTP 错误抛。
 */
export class CanvasRejectError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "CanvasRejectError";
  }
}
