import { createHash } from 'node:crypto'
import { z } from 'zod'
import { explicitGraduationMonth } from '@/v5/writing/education'
import type { CanonicalSourceDocument, ResumeEvidenceBundle } from '@/v5/types'

export const SOURCE_STRUCTURE_VERSION = 'source-structure-v2' as const
export const sourceStructureSchema = z.object({
  version: z.literal(SOURCE_STRUCTURE_VERSION), sourceRevision: z.string().min(1),
  previousSourceRevision: z.string().nullable().optional(), sourceAsOf: z.string().nullable().optional(),
  scopeMappings: z.array(z.object({previousScopeIds: z.array(z.string()), currentScopeIds: z.array(z.string()), reason: z.string()}).strict()).optional(),
  nodes: z.array(z.object({
    scopeId: z.string().min(1), kind: z.enum(['organization', 'employment', 'internship', 'internal_phase', 'project', 'education', 'other']),
    parentScopeId: z.string().nullable(), organization: z.string().nullable(), title: z.string().nullable(),
    start: z.string().nullable().optional(), end: z.string().nullable().optional(),
    sourceBlockIds: z.array(z.string()),
    phases: z.array(z.object({text: z.string(), sourceBlockId: z.string()}).strict()),
  }).strict()),
  issues: z.array(z.object({code: z.string(), scopeId: z.string(), reason: z.string()}).strict()),
}).strict()
export type SourceStructure = z.infer<typeof sourceStructureSchema>

type Context = { section: string; organization: string | null; employerBlockId: string | null; roleBlockId: string | null }
const entityPattern = /(?:公司|集团|大学|学院|研究院|银行|医院|药房|company\b|university\b|college\b)/iu
const clean = (value: string) => value.replace(/^#{1,6}\s*|^[-*•]\s*/gu, '').trim()
const sectionPattern = /^(?:工作经历|实习经历|教育背景|教育经历|代表项目|项目经历|专业技能|个人优势|work experience|internships?|education|projects?)$/iu
const phasePattern = /^\s*[-*•]\s*([^。；;:：|｜丨]{1,32})\s*[|｜丨]\s*((?:19|20)\d{2}[^:：。；;]*)(?:[:：]|$)/u

function sourceContexts(document: CanonicalSourceDocument) {
  const contexts = new Map<string, Context>()
  let current: Context = {section: '', organization: null, employerBlockId: null, roleBlockId: null}
  for (const [index, block] of document.blocks.entries()) {
    const text = clean(block.text)
    if (sectionPattern.test(text)) current = {section: text, organization: null, employerBlockId: null, roleBlockId: null}
    const next = document.blocks[index + 1]?.text ?? ''
    const explicitCareerHeader = /^(?:工作经历|实习经历|work experience|internships?)$/iu.test(current.section)
      && /[|｜丨]/u.test(text) && !/(?:19|20)\d{2}/u.test(text)
      && /(?:产品经理|设计师|助理|工程师|总监|专员|分析师|manager|designer|intern)/iu.test(next)
      && /(?:19|20)\d{2}/u.test(next)
    const entityHeading = text.length < 120 && (entityPattern.test(text) || explicitCareerHeader) && !/^[-*•]/u.test(block.text)
      && !/[。；;，,]/u.test(text) && (/^#{1,6}\s/u.test(block.text) || /[|｜丨]/u.test(text))
    if (entityHeading) {
      current = {...current, organization: text.split(/[|｜丨]/u)[0]!.trim(), employerBlockId: block.sourceBlockId, roleBlockId: null}
    }
    if (!entityHeading && !/^[-*•]/u.test(block.text) && /(?:产品经理|设计师|助理|工程师|总监|专员|分析师|manager|designer|intern)/iu.test(text)
      && /(?:19|20)\d{2}/u.test(text) && text.length < 100) current = {...current, roleBlockId: block.sourceBlockId}
    contexts.set(block.sourceBlockId, {...current})
  }
  return contexts
}

function sourceAsOf(document: CanonicalSourceDocument) {
  const dates = document.blocks.flatMap(block => [...block.text.matchAll(/(?:简历(?:更新)?日期|更新于|材料截至|截至日期|as of)\s*[:：]?\s*((?:19|20)\d{2}[.\-/年](?:0?[1-9]|1[0-2])(?:[.\-/月](?:0?[1-9]|[12]\d|3[01])日?)?)/giu)].map(match => match[1]!))
  return dates.length === 1 ? dates[0]! : null
}

/** Server-owned source inheritance changes only the new bundle, never raw blocks or a historical revision. */
export function preserveSourceTimeline(document: CanonicalSourceDocument, bundle: ResumeEvidenceBundle,
  options: {previousStructure?: SourceStructure} = {}): ResumeEvidenceBundle {
  const atoms = new Map(bundle.evidenceAtoms.map(atom => [atom.evidenceId, atom]))
  const blockIndex = new Map(document.blocks.map((block, index) => [block.sourceBlockId, index]))
  const contexts = sourceContexts(document)
  const ownedBlocks = (scopeId: string) => [...new Set(bundle.evidenceAtoms.filter(atom => atom.sourceScopeId === scopeId).map(atom => atom.sourceBlockId))]
  const firstBlock = (item: ResumeEvidenceBundle['timeline'][number]) => item.evidenceIds.flatMap(id => atoms.get(id) ? [atoms.get(id)!.sourceBlockId] : [])
    .sort((a, b) => (blockIndex.get(a) ?? Infinity) - (blockIndex.get(b) ?? Infinity))[0]
  const timeline = bundle.timeline.map(item => {
    const first = firstBlock(item), context = first ? contexts.get(first) : undefined
    const graduation = item.kind === 'education' ? explicitGraduationMonth(bundle.evidenceAtoms.filter(atom => atom.sourceScopeId === item.scopeId), item.end) : undefined
    const projectSection = context && /^(?:代表项目|项目经历|projects?)$/iu.test(context.section)
    const heading = first ? document.blocks[blockIndex.get(first)!]?.text : undefined
    // A role/date caption inside an explicitly separate project section cannot
    // establish another job. Keep the source project heading as its identity.
    const preciseItem = {...item, ...(graduation ? {end: graduation} : {}),
      ...(projectSection && ['experience', 'internship', 'project'].includes(item.kind) ? {kind: 'project' as const,
        ...(/^#{1,6}\s/u.test(heading ?? '') ? {title: clean(heading!)} : {})} : {})}
    if (!context) return preciseItem
    const career = ['experience', 'internship'].includes(item.kind)
    const scopedOrganization = context.organization && (career || item.kind === 'education') ? context.organization : null
    return {...preciseItem, organization: item.organization || scopedOrganization,
      kind: career && /^(?:实习经历|internships?)$/iu.test(context.section) ? 'internship' as const : preciseItem.kind}
  })
  const projectParents = new Map<string, string>()
  for (const project of timeline.filter(item => item.kind === 'project')) {
    const sourceText = ownedBlocks(project.scopeId).map(id => document.blocks[blockIndex.get(id)!]?.text ?? '').join('\n')
    if (!/实习期间/u.test(sourceText)) continue
    const matches = timeline.filter(item => ['experience', 'internship'].includes(item.kind)
      && item.organization && item.title && sourceText.includes(item.organization) && sourceText.includes(item.title)
      && item.start?.match(/(?:19|20)\d{2}/u)?.[0]
      && sourceText.includes(item.start.match(/(?:19|20)\d{2}/u)![0]))
    if (matches.length === 1) projectParents.set(project.scopeId, matches[0]!.scopeId)
  }
  const nodes: SourceStructure['nodes'] = []
  const organizationIds = new Map<string, string>()
  const issues: SourceStructure['issues'] = []
  for (const item of timeline) {
    const first = firstBlock(item), context = first ? contexts.get(first) : undefined
    const sourceBlockIds = ownedBlocks(item.scopeId)
    const phaseOnly = first && phasePattern.test(document.blocks[blockIndex.get(first)!]?.text ?? '')
    const parent = phaseOnly && context?.employerBlockId ? nodes.find(node => ['employment', 'internship'].includes(node.kind)
      && node.sourceBlockIds.includes(context.employerBlockId!)) : undefined
    if (phaseOnly && parent && ['experience', 'internship', 'other'].includes(item.kind)) {
      // Keep fact scope IDs stable; the explicit parent relation prevents a dated internal phase becoming another job.
      item.kind = 'other'; item.organization = parent.organization; item.title ||= parent.title
      nodes.push({scopeId: item.scopeId, kind: 'internal_phase', parentScopeId: parent.scopeId,
        organization: parent.organization, title: phasePattern.exec(document.blocks[blockIndex.get(first!)!]!.text)?.[1]?.trim() ?? item.title,
        start: item.start, end: item.end, sourceBlockIds, phases: []})
      continue
    }
    let organizationId: string | null = null
    if (item.organization && ['experience', 'internship', 'education'].includes(item.kind)) {
      const key = `${context?.employerBlockId ?? item.scopeId}:${item.organization}`
      organizationId = organizationIds.get(key) ?? `${item.scopeId}:organization`
      if (!organizationIds.has(key)) {
        organizationIds.set(key, organizationId)
        nodes.push({scopeId: organizationId, kind: 'organization', parentScopeId: null,
          organization: item.organization, title: null, sourceBlockIds: context?.employerBlockId ? [context.employerBlockId] : sourceBlockIds, phases: []})
      }
    }
    const phases = sourceBlockIds.flatMap(id => {
      const block = document.blocks[blockIndex.get(id)!]
      return block && phasePattern.test(block.text) ? [{text: block.text, sourceBlockId: id}] : []
    })
    nodes.push({scopeId: item.scopeId, kind: item.kind === 'experience' ? 'employment' : item.kind === 'internship' ? 'internship'
      : item.kind === 'education' ? 'education' : item.kind === 'project' ? 'project' : 'other', parentScopeId: projectParents.get(item.scopeId) ?? organizationId,
      organization: item.organization, title: item.title, start: item.start, end: item.end, sourceBlockIds, phases})
    for (const phase of phases) nodes.push({scopeId: `${item.scopeId}:phase:${phase.sourceBlockId}`, kind: 'internal_phase',
      parentScopeId: item.scopeId, organization: item.organization, title: phasePattern.exec(phase.text)?.[1]?.trim() ?? null,
      sourceBlockIds: [phase.sourceBlockId], phases: []})
    if (['experience', 'internship'].includes(item.kind) && (!item.organization || !item.title)) issues.push({
      code: 'SOURCE_TIMELINE_IDENTITY_INCOMPLETE', scopeId: item.scopeId, reason: '任职雇主或岗位尚未由完整来源支持，不能以裸日期交付。'})
  }
  const asOf = sourceAsOf(document)
  const sourceRevision = `source_${createHash('sha256').update(JSON.stringify({sha: document.sha256, version: SOURCE_STRUCTURE_VERSION, nodes, sourceAsOf: asOf})).digest('hex').slice(0, 24)}`
  const previous = options.previousStructure ?? bundle.sourceStructure
  const scopeMappings = previous && previous.sourceRevision !== sourceRevision ? previous.nodes.flatMap(old => {
    const currentScopeIds = nodes.filter(node => node.sourceBlockIds.some(id => old.sourceBlockIds.includes(id))).map(node => node.scopeId)
    return [{previousScopeIds: [old.scopeId], currentScopeIds, reason: '按不可变来源块重建层级；下游判断须使用新 sourceRevision。'}]
  }) : previous?.scopeMappings ?? []
  return {...bundle, timeline, sourceStructure: {version: SOURCE_STRUCTURE_VERSION, sourceRevision, nodes, issues,
    sourceAsOf: asOf, previousSourceRevision: previous?.sourceRevision !== sourceRevision ? previous?.sourceRevision ?? null : previous.previousSourceRevision ?? null,
    scopeMappings}}
}
