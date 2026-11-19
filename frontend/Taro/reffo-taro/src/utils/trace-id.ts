/** 生成请求 traceId（UUID v4），crypto.randomUUID 不可用时回退到手写实现。 */
export function createTraceId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, character => {
    const value = Math.floor(Math.random() * 16)
    return (character === 'x' ? value : (value & 3) | 8).toString(16)
  })
}
