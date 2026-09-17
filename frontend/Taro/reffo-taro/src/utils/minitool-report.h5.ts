import type {ProcessResult} from '@/types'

const WIDTH = 1080
const HEIGHT = 1440
const MARGIN = 72
const CONTENT_WIDTH = WIDTH - MARGIN * 2

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(Number(value) || 0)))
}

function wrapText(context: CanvasRenderingContext2D, value: string, maxWidth: number, maxLines: number) {
  const lines: string[] = []
  const paragraphs = String(value || '').split('\n')

  for (const paragraph of paragraphs) {
    let current = ''
    for (const character of Array.from(paragraph)) {
      const candidate = current + character
      if (current && context.measureText(candidate).width > maxWidth) {
        lines.push(current)
        current = character
        if (lines.length >= maxLines) return lines
      } else {
        current = candidate
      }
    }
    if (current) {
      lines.push(current)
      if (lines.length >= maxLines) return lines
    }
  }

  return lines
}

function drawWrappedText(
  context: CanvasRenderingContext2D,
  value: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines: number,
) {
  const lines = wrapText(context, value, maxWidth, maxLines)
  lines.forEach((line, index) => {
    const isLast = index === maxLines - 1 && lines.length === maxLines
    context.fillText(isLast && line.length < value.length ? `${line}…` : line, x, y + index * lineHeight)
  })
  return y + lines.length * lineHeight
}

function drawSectionTitle(context: CanvasRenderingContext2D, title: string, y: number) {
  context.fillStyle = '#111111'
  context.font = '800 34px "PingFang SC", "Microsoft YaHei", sans-serif'
  context.fillText(title, MARGIN, y)
  context.fillStyle = '#2563eb'
  context.fillRect(MARGIN, y + 18, 72, 8)
  return y + 58
}

function getStructureScore(result: ProcessResult) {
  const structured = result.analysis.structured_resume
  return Math.round(
    (structured.personal_info.name ? 20 : 0) +
    (structured.experience.length > 0 ? 25 : 0) +
    (structured.projects.length > 0 ? 20 : 0) +
    (structured.education.length > 0 ? 15 : 0) +
    (structured.skills.hard_skills.length > 0 ? 20 : 0),
  )
}

function getQuantifiedCount(resumeMarkdown: string) {
  return resumeMarkdown
    .split('\n')
    .filter(line => /(提升|降低|增长|完成|覆盖|服务|管理|节省|转化|上线|优化|达到|超过|交付|新增|留存|效率|规模)/.test(line)
      && /\d+(?:\.\d+)?\s*(?:%|％|万|千|亿|人|次|条|个|项|天|日|周|月|年|倍|分|小时|台|家|款|篇|元|k|w|b|gb|mb|fps|bp)/i.test(line))
    .length
}

function drawMetric(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  label: string,
  value: number,
  color: string,
) {
  context.fillStyle = '#f4f6f8'
  context.fillRect(x, y, width, 156)
  context.fillStyle = color
  context.font = '800 54px Georgia, serif'
  context.fillText(String(clampScore(value)), x + 26, y + 66)
  context.fillStyle = '#4b5563'
  context.font = '600 24px "PingFang SC", "Microsoft YaHei", sans-serif'
  context.fillText(label, x + 26, y + 112)
}

export function buildMiniToolReport(options: {
  result: ProcessResult
  resumeMarkdown: string
  companyName: string
  positionName: string
}) {
  if (typeof document === 'undefined') {
    throw new Error('当前环境不支持生成报告图片')
  }

  const canvas = document.createElement('canvas')
  canvas.width = WIDTH
  canvas.height = HEIGHT
  const context = canvas.getContext('2d')
  if (!context) throw new Error('报告画布初始化失败')

  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, WIDTH, HEIGHT)
  context.fillStyle = '#101521'
  context.fillRect(0, 0, WIDTH, 260)
  context.fillStyle = '#ffffff'
  context.font = '800 44px "PingFang SC", "Microsoft YaHei", sans-serif'
  context.fillText('Reffo 简历分析', MARGIN, 88)
  context.fillStyle = '#93c5fd'
  context.font = '600 27px "PingFang SC", "Microsoft YaHei", sans-serif'
  const target = `${options.companyName || '目标公司'} · ${options.positionName || '目标岗位'}`
  drawWrappedText(context, target, MARGIN, 146, CONTENT_WIDTH, 38, 2)

  context.fillStyle = '#2563eb'
  context.beginPath()
  context.arc(WIDTH - 174, 126, 74, 0, Math.PI * 2)
  context.fill()
  context.fillStyle = '#ffffff'
  context.textAlign = 'center'
  context.font = '800 58px Georgia, serif'
  context.fillText(String(options.result.matching.match_score), WIDTH - 174, 142)
  context.font = '600 20px "PingFang SC", "Microsoft YaHei", sans-serif'
  context.fillText('匹配度', WIDTH - 174, 177)
  context.textAlign = 'left'

  const metricGap = 18
  const metricWidth = (CONTENT_WIDTH - metricGap * 2) / 3
  drawMetric(context, MARGIN, 302, metricWidth, '简历结构', getStructureScore(options.result), '#2563eb')
  drawMetric(context, MARGIN + metricWidth + metricGap, 302, metricWidth, '关键词覆盖', options.result.matching.skill_match.match_percentage, '#0f766e')
  drawMetric(context, MARGIN + (metricWidth + metricGap) * 2, 302, metricWidth, '量化成果', Math.min(100, getQuantifiedCount(options.resumeMarkdown) * 20), '#c2410c')

  let y = drawSectionTitle(context, '关键词覆盖', 548)
  const matched = options.result.matching.skill_match.matched_skills
  const missing = options.result.matching.skill_match.missing_skills
  context.font = '600 25px "PingFang SC", "Microsoft YaHei", sans-serif'
  context.fillStyle = '#166534'
  y = drawWrappedText(context, `已覆盖：${matched.slice(0, 8).join('、') || '暂无'}`, MARGIN, y, CONTENT_WIDTH, 38, 3)
  context.fillStyle = '#9f1239'
  y = drawWrappedText(context, `待补齐：${missing.slice(0, 8).join('、') || '无明显缺口'}`, MARGIN, y + 8, CONTENT_WIDTH, 38, 3)

  y = drawSectionTitle(context, '优先优化', y + 46)
  context.fillStyle = '#222222'
  context.font = '500 25px "PingFang SC", "Microsoft YaHei", sans-serif'
  options.result.matching.optimization_suggestions.slice(0, 4).forEach((suggestion, index) => {
    y = drawWrappedText(context, `${index + 1}. ${suggestion}`, MARGIN, y, CONTENT_WIDTH, 38, 2) + 12
  })

  y = drawSectionTitle(context, '结果提示', Math.min(y + 36, 1190))
  context.fillStyle = '#4b5563'
  context.font = '500 24px "PingFang SC", "Microsoft YaHei", sans-serif'
  drawWrappedText(context, '本报告由本地规则生成，只基于你输入的简历与 JD。请核实所有事实，不要把未发生经历写入简历。', MARGIN, y, CONTENT_WIDTH, 38, 4)

  context.fillStyle = '#6b7280'
  context.font = '500 22px "PingFang SC", "Microsoft YaHei", sans-serif'
  context.fillText('Reffo · 本机分析', MARGIN, HEIGHT - 54)

  return canvas.toDataURL('image/png')
}
