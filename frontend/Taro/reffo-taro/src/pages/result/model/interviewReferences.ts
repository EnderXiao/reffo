import type {ProcessResult} from '@/types'

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
  const stories = result.interview?.story_recommendations ?? []

  return stories.map(story => {
    const title = story.title || '未命名故事'
    const background = story.background || ''
    const storyResult = story.result || ''
    const storytellingApproach = Array.isArray(story.storytelling_approach)
      ? story.storytelling_approach.filter(point => typeof point === 'string' && point.trim()).map(point => point.trim())
      : []
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
      storytellingApproach,
      resumeQuote,
      jdQuote,
    }
  })
}
