// AI 诊断展示纯工具函数：不依赖 React/后端，供组件与 node --test 单测复用。

// 与后端 rootCauseClass 枚举对齐：provider_http | timeout | network | stream_incomplete | rate_limit | output_validation | unknown
const ROOT_CAUSE_CLASS_LABELS: Record<string, string> = {
  provider_http: "模型供应商HTTP错误",
  timeout: "请求超时",
  network: "网络连接失败",
  stream_incomplete: "模型流提前中断",
  rate_limit: "模型限流",
  output_validation: "输出校验失败",
  unknown: "未知原因",
};

/** 根因分类的中文映射，未知分类原样返回（后端可扩展，前端不遮挡新值）。 */
export function rootCauseClassLabel(rootCauseClass: string): string {
  return ROOT_CAUSE_CLASS_LABELS[rootCauseClass] ?? rootCauseClass;
}

const CONFIDENCE_LABELS: Record<string, string> = {
  high: "高置信",
  medium: "中置信",
  low: "低置信",
};

export function confidenceLabel(confidence: "high" | "medium" | "low"): string {
  return CONFIDENCE_LABELS[confidence] ?? confidence;
}

/** 毫秒 → `1.2s` / `43.6s`；null → `—`。 */
export function durationMsLabel(ms: number | null): string {
  if (ms == null) return "—";
  return (ms / 1000).toFixed(1) + "s";
}

/** token 数量：null → `—`，数字加千分位。 */
export function tokenLabel(tokens: number | null): string {
  if (tokens == null) return "—";
  return tokens.toLocaleString("en-US");
}
