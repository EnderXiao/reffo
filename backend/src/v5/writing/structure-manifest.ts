import type {CanonicalSourceDocument, GeneratedResumeArtifact, ResumeEvidenceBundle} from '@/v5/types'
import type {EntryWritingPlan} from './entries'
import type {ResumeCompletionDocument} from '@/shared/resume-completion'
import type {ResumeStructureBasis} from '@/shared/resume-actions'

/** Source headers are quoted verbatim. Output ownership comes from compiled evidence/entry IDs, never text similarity. */
export function buildResumeStructureBasis(input: {source: CanonicalSourceDocument; resume: ResumeEvidenceBundle;
  artifact: GeneratedResumeArtifact; document: ResumeCompletionDocument; entryPlan?: EntryWritingPlan}): ResumeStructureBasis {
  const {source, resume, artifact, document} = input
  const atoms = new Map(resume.evidenceAtoms.map(atom => [atom.evidenceId, atom]))
  const sourceIndex = new Map(source.blocks.map((block, index) => [block.sourceBlockId, index]))
  const clean = (text: string) => text.replace(/^#{1,6}\s*/u, '').trim()
  const sections = new Set(['个人优势', '个人简介', '个人信息', '工作经历', '实习经历', '项目经历', '代表项目', '研究经历', '教育背景', '教育经历', '专业技能', '技能', '荣誉奖励', '获奖经历'])
  return {version: 'resume-structure-basis-v1', sourceRevision: resume.sourceStructure?.sourceRevision ?? source.sha256,
    sourceSectionTitles: source.blocks.filter(block => sections.has(clean(block.text))).map(block => clean(block.text)),
    nodes: (resume.sourceStructure?.nodes ?? resume.timeline.map(scope => ({...scope, parentScopeId: null,
      sourceBlockIds: scope.evidenceIds.flatMap(id => atoms.get(id)?.sourceBlockId ?? []), phases: []}))).filter(node => node.kind !== 'organization').map(node => {
      const sourceBlocks = source.blocks.filter(block => node.sourceBlockIds.includes(block.sourceBlockId))
      const quote = sourceBlocks.find(block => !/^\s*[-*•]/u.test(block.text) && (block.text.includes(node.organization ?? '\0') || block.text.includes(node.title ?? '\0')))
        ?? sourceBlocks[0]
      // Referencing a scope in a summary/skills does not retain its business entry.
      // Fixed timeline and education rows have scoped paths even without a writer entry ID.
      const entryIds = input.entryPlan?.entries.filter(entry => entry.scopeId === node.scopeId
        && !['summary', 'skill', 'ancillary'].includes(entry.slot.kind)).map(entry => entry.entryId) ?? []
      const ownsPath = (path: string) => path === `timeline.${node.scopeId}`
        || ['experience', 'project', 'research', 'education', 'other'].some(section => path.startsWith(`${section}.${node.scopeId}.bullets[`))
      const phaseEvidenceIds = new Set(node.kind === 'internal_phase' ? resume.evidenceAtoms
        .filter(atom => node.sourceBlockIds.includes(atom.sourceBlockId)).map(atom => atom.evidenceId) : [])
      const parentOwnsPath = (path: string) => node.kind === 'internal_phase' && node.parentScopeId
        && ['experience', 'project', 'research', 'education', 'other'].some(section => path.startsWith(`${section}.${node.parentScopeId}.bullets[`))
      const paths = new Set(artifact.claims.filter(claim => ownsPath(claim.outputPath)
        || (parentOwnsPath(claim.outputPath) && claim.evidenceIds.some(id => phaseEvidenceIds.has(id)))).map(claim => claim.outputPath))
      const blocks = document.blocks.filter(block => (block.outputPath && paths.has(block.outputPath)) || (block.entryId && entryIds.includes(block.entryId)))
      const protectedValues = ['employment', 'experience', 'internship', 'education'].includes(node.kind)
        ? [node.organization, node.title, ...(node.kind === 'internship' ? ['实习'] : [])].filter((value): value is string => Boolean(value)) : []
      return {scopeId: node.scopeId, kind: node.kind, parentScopeId: node.parentScopeId,
        label: [node.organization, node.title].filter(Boolean).join('｜') || quote && clean(quote.text) || '来源中未命名的经历',
        sourceOrder: Math.min(source.blocks.length, ...node.sourceBlockIds.map(id => sourceIndex.get(id) ?? source.blocks.length)),
        ...(quote ? {beforeQuote: quote.text} : {}), blockIds: blocks.map(block => block.blockId), entryIds, protectedValues}
    })}
}
