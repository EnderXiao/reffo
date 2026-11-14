import { createDigest } from '@/harness/run-context'
import { createCompletionDocument, serializeWithoutAllGapClauses, validateCompletionDocument, validateOmissionSafety,
  type ResumeCompletionBlock, type ResumeGapSegment, type ResumeTextSegment, type ResumeDependentClaim, type ResumeRequiredDetailGap } from '@/shared/resume-completion'
import { SupportedWritingError } from './compiler'
import { writingIssue } from './facts'
import { gapPresentation, type DetailAssessment, type EntrySegment, type GapSegment, type RequiredDetailGap } from './entry-skeleton'

function detailSubject(segment: GapSegment | RequiredDetailGap, details?: readonly DetailAssessment[]) {
  return details?.find(detail => detail.detailId === segment.detailId)?.subject
    .replace(/[【】]/gu, bracket => bracket === '【' ? '「' : '」').replace(/\s+/gu, ' ').trim()
}

function detailPresentation(segment: GapSegment | RequiredDetailGap, details?: readonly DetailAssessment[]) {
  const presentation = gapPresentation(segment)
  const subject = detailSubject(segment, details)
  if (!subject) return presentation
  const instructions: Partial<Record<GapSegment['template'], string>> = {
    implementation_stage: `填「${subject}」当前实际实施阶段`,
    metric_definition: `填「${subject}」实际采用的判断标准`,
    metric_period: `填「${subject}」实际统计的起止时间`,
    metric_population: `填「${subject}」实际纳入统计的对象或样本范围`,
    human_intervention: `填「${subject}」实际仍需人工处理的环节`,
  }
  return {...presentation, label: `${subject}｜${presentation.label}`,
    instruction: instructions[segment.template] ?? `关于「${subject}」，${presentation.instruction}`}
}

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
  detailAssessmentsByPath?: ReadonlyMap<string, readonly DetailAssessment[]>
  enabledGaps: ReadonlyMap<string, ReadonlySet<number>>
  artifactMarkdown: string
  schemaVersion?: 'resume-completion-v1' | 'resume-completion-v2' | 'resume-completion-v3' | 'resume-completion-v4'
  unitsByPath?: ReadonlyMap<string, {unitId: string; entryId: string}>
}) {
  const documentId = input.documentId ?? `completion:${createDigest(input.artifactMarkdown).slice(0, 24)}`
  const blocks = input.renderedBlocks.map((rendered, blockIndex) => {
    const blockId = `${documentId}:block:${blockIndex}`
    const block = ordinaryBlock(rendered.raw, blockId)
    if (rendered.outputPath) block.outputPath = rendered.outputPath
    const unit = rendered.outputPath ? input.unitsByPath?.get(rendered.outputPath) : undefined
    if (unit) {block.unitId = unit.unitId; block.outputPath = rendered.outputPath; block.entryId = unit.entryId}
    const paragraph = rendered.outputPath ? input.finalParagraphs.get(rendered.outputPath) : undefined
    const enabled = rendered.outputPath ? input.enabledGaps.get(rendered.outputPath) : undefined
    const details = rendered.outputPath ? input.detailAssessmentsByPath?.get(rendered.outputPath) : undefined
    if (!paragraph?.segments || (!enabled?.size && !paragraph.segments.some(segment => segment.kind === 'dependent_claim'))) return block
    block.segments = paragraph.segments.flatMap((segment, index): Array<ResumeTextSegment | ResumeGapSegment | ResumeDependentClaim> => {
      if (segment.kind === 'fact') return [{kind: 'text', segmentId: `${blockId}:text:${index}`, markdown: segment.text, origin: 'generated'}]
      if (segment.kind === 'dependent_claim') {
        const claimId = `${blockId}:claim:${index}`
        const preceding = paragraph.segments![index - 1]
        const hasBoundary = preceding?.kind === 'fact' && /[。！？.!?；;]\s*$/u.test(preceding.text)
        const parts = segment.parts.flatMap((part, partIndex): ResumeDependentClaim['parts'] => {
          if (part.kind === 'fact') return [{kind: 'text', segmentId: `${claimId}:text:${partIndex}`,
            markdown: partIndex === 0 && hasBoundary ? part.text.replace(/^[，；,;]/u, '') : part.text, origin: 'generated'}]
          const presentation = detailPresentation(part, details)
          const subject = detailSubject(part, details)
          const scope: ResumeTextSegment[] = input.schemaVersion !== 'resume-completion-v4' && subject ? [{kind: 'text', segmentId: `${claimId}:subject:${partIndex}`,
            markdown: `；关于${subject}`, origin: 'generated'}] : []
          return [...scope, {kind: 'required_detail_gap', gapId: `${claimId}:gap:${partIndex}`, detailId: part.detailId,
            element: presentation.element, template: part.template, prefix: presentation.prefix, suffix: presentation.suffix,
            label: presentation.label, instruction: presentation.instruction, benefit: presentation.benefit,
            ...(part.hint ? {hint: part.hint} : {}),
            candidates: [], fill: {state: 'empty'}} satisfies ResumeRequiredDetailGap]
        })
        return [{kind: 'dependent_claim', claimId, sourceEvidenceIds: segment.sourceEvidenceIds,
          sourceSpans: segment.sourceSpans, readiness: segment.readiness, qualifiers: segment.qualifiers,
          parts, requiredGapIds: parts.flatMap(part => part.kind === 'required_detail_gap' ? [part.gapId] : []), fillPolicy: 'all_required'}]
      }
      if (!enabled?.has(index)) return []
      const presentation = detailPresentation(segment, details)
      return [{kind: 'optional_gap_clause', gapId: `${blockId}:gap:${index}`, ...(segment.detailId ? {detailId: segment.detailId} : {}), element: presentation.element,
        template: segment.template, prefix: presentation.prefix, suffix: presentation.suffix, label: presentation.label,
        instruction: presentation.instruction, benefit: presentation.benefit, ...(segment.hint ? {hint: segment.hint} : {}),
        candidates: segment.candidates.flatMap((candidate): ResumeGapSegment['candidates'] => candidate.kind === 'source'
          ? [{text: candidate.text, kind: 'source_reference' as const}]
          : (candidate.kind === 'implementation_stages' ? ['方案设计', '开发中', '已上线'] : ['需求文档', '页面原型', '交互流程']).map(text => ({text, kind: 'category_example' as const}))),
        fill: {state: 'empty'}, retainedFacts: []}]
    })
    for (const [index, segment] of paragraph.segments.entries()) {
      if (segment.kind !== 'optional_gap_clause' || segment.template !== 'metric_detail' || !segment.metric || !enabled?.has(index)) continue
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
  for (const block of blocks) if (block.unitId) for (const segment of block.segments) {
    segment.unitId = block.unitId
    if (segment.kind === 'dependent_claim') for (const part of segment.parts) part.unitId = block.unitId
  }
  const document = createCompletionDocument({documentId, blocks, schemaVersion: input.schemaVersion})
  const validation = validateCompletionDocument(document)
  if (!validation.ok || validateOmissionSafety(document).length
    || serializeWithoutAllGapClauses(document) !== input.artifactMarkdown) throw new SupportedWritingError([
    writingIssue('WRITER_PROJECTION_MISMATCH', 'entries', [], '编辑文档的结构或事实投影与最终 Artifact 不一致。'),
  ])
  return document
}
