import { createDigest } from '@/harness/run-context'
import { createCompletionDocument, serializeWithoutAllGapClauses, validateCompletionDocument, validateOmissionSafety,
  type ResumeCompletionBlock, type ResumeGapSegment, type ResumeTextSegment } from '@/shared/resume-completion'
import { SupportedWritingError } from './compiler'
import { writingIssue } from './facts'
import { gapPresentation, type EntrySegment } from './entry-skeleton'

function ordinaryBlock(raw: string, blockId: string): ResumeCompletionBlock {
  const heading = /^(#{1,3})\s+/u.exec(raw), bullet = /^[-*+]\s+/u.exec(raw), numbered = /^\d+[.)]\s+/u.exec(raw)
  const prefix = heading?.[0] ?? bullet?.[0] ?? numbered?.[0] ?? ''
  const kind = !raw ? 'blank' : /^\s*(?:---+|___+|\*\*\*+)\s*$/u.test(raw) ? 'divider'
    : heading ? `heading${heading[1].length}` as 'heading1' | 'heading2' | 'heading3'
    : bullet ? 'bullet' : numbered ? 'numbered' : 'paragraph'
  return {blockId, kind, prefix, segments: raw ? [{kind: 'text', segmentId: `${blockId}:text:0`,
    markdown: raw.slice(prefix.length), origin: 'generated'}] : []}
}

export function buildCompletionDocument(input: {
  documentId?: string
  renderedBlocks: Array<{raw: string; outputPath?: string}>
  finalParagraphs: ReadonlyMap<string, {segments?: EntrySegment[]}>
  enabledGaps: ReadonlyMap<string, ReadonlySet<number>>
  artifactMarkdown: string
}) {
  const documentId = input.documentId ?? `completion:${createDigest(input.artifactMarkdown).slice(0, 24)}`
  const blocks = input.renderedBlocks.map((rendered, blockIndex) => {
    const blockId = `${documentId}:block:${blockIndex}`
    const block = ordinaryBlock(rendered.raw, blockId)
    const paragraph = rendered.outputPath ? input.finalParagraphs.get(rendered.outputPath) : undefined
    const enabled = rendered.outputPath ? input.enabledGaps.get(rendered.outputPath) : undefined
    if (!paragraph?.segments || !enabled?.size) return block
    block.segments = paragraph.segments.flatMap((segment, index): Array<ResumeTextSegment | ResumeGapSegment> => {
      if (segment.kind === 'fact') return [{kind: 'text', segmentId: `${blockId}:text:${index}`, markdown: segment.text, origin: 'generated'}]
      if (!enabled.has(index)) return []
      const presentation = gapPresentation(segment)
      return [{kind: 'optional_gap_clause', gapId: `${blockId}:gap:${index}`, element: presentation.element,
        template: segment.template, prefix: presentation.prefix, suffix: presentation.suffix, label: presentation.label,
        instruction: presentation.instruction, benefit: presentation.benefit,
        candidates: segment.candidates.flatMap((candidate): ResumeGapSegment['candidates'] => candidate.kind === 'source'
          ? [{text: candidate.text, kind: 'source_reference' as const}]
          : ['需求文档', '页面原型', '交互流程'].map(text => ({text, kind: 'category_example' as const}))),
        fill: {state: 'empty'}, retainedFacts: []}]
    })
    for (const [index, segment] of paragraph.segments.entries()) {
      if (segment.kind !== 'optional_gap_clause' || segment.template !== 'metric_detail' || !segment.metric || !enabled.has(index)) continue
      const gap = block.segments.find((node): node is ResumeGapSegment => node.kind === 'optional_gap_clause' && node.gapId === `${blockId}:gap:${index}`)!
      const numbers = `${segment.metric.before}${segment.metric.after}`.match(/\d+(?:\.\d+)?/gu) ?? []
      const object = segment.metric.object
      const anchor = block.segments.flatMap(node => node.kind === 'text'
        ? node.markdown.split(/[，。；;！!？?]/u).filter(text => text.includes(object) && numbers.every(number => text.includes(number)))
          .map(exactText => ({textSegmentId: node.segmentId, exactText})) : [])[0]
      if (!anchor) throw new SupportedWritingError([writingIssue('WRITER_GAP_CANDIDATE_INVALID', rendered.outputPath ?? 'entries', [],
        '指标空位的已知对象、数字和关系须同时保留在一个完整事实分句中，供省略时精确核对。')])
      gap.retainedFacts = [anchor]
    }
    return block
  })
  const document = createCompletionDocument({documentId, blocks})
  const validation = validateCompletionDocument(document)
  if (!validation.ok || validateOmissionSafety(document).length
    || serializeWithoutAllGapClauses(document) !== input.artifactMarkdown) throw new SupportedWritingError([
    writingIssue('WRITER_PROJECTION_MISMATCH', 'entries', [], '编辑文档的结构或事实投影与最终 Artifact 不一致。'),
  ])
  return document
}
