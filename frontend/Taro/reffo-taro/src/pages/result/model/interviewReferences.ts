import type {ProcessResult} from '@/types'

function normalizeItems(value: unknown, limit = 4): string[] {
  if (!Array.isArray(value)) return []

  return value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map(item => item.trim())
    .slice(0, limit)
}

function normalizeReferenceLine(line: string) {
  return line
    .replace(/^#{1,6}\s*/, '')
    .replace(/^[-*+]\s+/, '')
    .replace(/^\d+[.)、]\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function splitReferenceLines(source: string) {
  return source
    .split(/\r?\n+/)
    .map(normalizeReferenceLine)
    .filter(line => line.length >= 4)
}

function tokenizeReferenceText(text: string) {
  const normalized = text.toLowerCase()
  const asciiTokens = normalized.match(/[a-z0-9][a-z0-9+#.-]{1,}/g) ?? []
  const cjkTokens = normalized.match(/[\u4e00-\u9fa5]{2,}/g) ?? []
  const cjkPairs = cjkTokens.flatMap(token => {
    if (token.length <= 4) {
      return [token]
    }

    return Array.from({length: token.length - 1}, (_, index) => token.slice(index, index + 2))
  })

  return Array.from(new Set([...asciiTokens, ...cjkTokens, ...cjkPairs]))
}

function clipReferenceLine(line: string, maxLength = 48) {
  if (line.length <= maxLength) {
    return line
  }

  return `${line.slice(0, maxLength - 1)}…`
}

export function findBestOriginalQuote(source: string, query: string, fallbackQuery = '') {
  const lines = splitReferenceLines(source)

  if (lines.length === 0) {
    return ''
  }

  const queryTokens = tokenizeReferenceText(`${query} ${fallbackQuery}`)
  const scored = lines
    .map((line, index) => {
      const lowerLine = line.toLowerCase()
      const score = queryTokens.reduce((total, token) => (
        lowerLine.includes(token) ? total + Math.min(token.length, 8) : total
      ), 0)

      return {line, index, score}
    })
    .sort((left, right) => right.score - left.score || left.index - right.index)

  const best = scored[0]
  const selected = best && best.score > 0
    ? best.line
    : lines.find(line => /岗位|职责|要求|经验|项目|负责|开发|平台|系统|能力|熟悉|掌握/.test(line)) ?? lines[0]

  return clipReferenceLine(selected)
}

export function buildInterviewStoryViewItems(
  result: ProcessResult,
  resumeContent: string,
  jdContent: string,
) {
  const strengths = normalizeItems(result.analysis.strengths, 3)
  const stories = result.interview?.story_recommendations ?? []
  const fallbackStories = [
    {
      title: strengths[0] || '高匹配项目经历',
      background: strengths[1] || result.analysis.capability_summary || '围绕目标岗位要求，选择最能证明能力迁移的项目经历展开。',
      result: result.optimized.changes_summary[0] || '用量化结果和职责边界说明你的贡献，避免只描述过程。',
    },
    {
      title: '补齐短板的备选故事',
      background: '选择一段能回应岗位关键短板的经历，说明你如何快速学习、协作推进或补齐经验。',
      result: '强调可验证的交付结果、复盘沉淀或能力迁移，避免只描述主观态度。',
    },
  ]
  const viewStories = [
    stories[0] ?? fallbackStories[0],
    stories[1] ?? fallbackStories[1],
  ]

  return viewStories.map((story, index) => {
    const title = story.title || fallbackStories[index].title
    const background = story.background || fallbackStories[index].background
    const storyResult = story.result || fallbackStories[index].result
    const query = `${title} ${background} ${storyResult}`
    const resumeQuote = findBestOriginalQuote(resumeContent || result.optimized.optimized_resume, query, title)
    const jdQuote = findBestOriginalQuote(
      jdContent,
      `${query} ${result.matching.hard_requirements_match.map(item => item.requirement).join(' ')}`,
      result.matching.skill_match.missing_skills.join(' '),
    )

    return {
      title,
      background,
      result: storyResult,
      resumeQuote,
      jdQuote,
    }
  })
}
