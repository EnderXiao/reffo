import { createHash } from 'node:crypto'

/** 归一化动态值，让同类错误的 message 稳定（数字、UUID、邮箱、URL 归一为占位符）。 */
export function normalizeText(text: string): string {
  return text
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>')
    .replace(/\b\d+\b/g, '<n>')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '<email>')
    .replace(/https?:\/\/\S+/g, '<url>')
}

/** 取 stack 的第一帧（最接近出错点的位置）。 */
function firstStackFrame(stack?: string): string {
  const lines = stack?.split('\n').map(line => line.trim()).filter(Boolean) ?? []
  const frame = lines.find(line => line.startsWith('at '))
  return frame ? frame.replace(/\s+/g, ' ').slice(0, 120) : ''
}

/**
 * 错误分组指纹：错误类型 + 出错位置 + 归一化 message 的哈希。
 * 相同指纹归为同一个 issue，用于频次/趋势聚合。
 */
export function errorFingerprint(input: { name?: string; message?: string; stack?: string }): string {
  const name = input.name || 'Error'
  const message = normalizeText(input.message ?? '')
  const frame = firstStackFrame(input.stack)
  const raw = [name, frame, message].filter(Boolean).join('|')
  return createHash('sha256').update(raw).digest('hex').slice(0, 16)
}
