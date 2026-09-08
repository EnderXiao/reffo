import type { WritingPlan } from '@/v5/writing/plan'
import type { JobRequirementBundle } from '@/v5/types'
import { preserveNamedSkillSignals } from '@/v5/writing/tool-signals'

export const STRUCTURAL_WRITING_POLICY = 'document-editorial-v1' as const
export interface DocumentEditorialBrief {
  version: typeof STRUCTURAL_WRITING_POLICY
  backgroundEvidenceId?: string
  arguments: Array<{ anchorEvidenceId: string; targetTaskIds: string[]; detailSlotIds: string[] }>
  representativeSlotIds: string[]
  abstractBudgets: { unit: 'cjk_characters' | 'words'; summaryMax: number; skillMax: number }
  sectionRoles: { summary: string; work: string; project: string; skills: string }
}

/** Opt-in editorial experiment. Reorganize existing material; never alter source facts. */
export function applyDocumentEditorialPlan(original: WritingPlan, job?: JobRequirementBundle): WritingPlan {
  if (!original.targeting) throw new Error('DOCUMENT_EDITORIAL_REQUIRES_TARGETING')
  if (original.documentEditorial?.version === STRUCTURAL_WRITING_POLICY) return structuredClone(original)
  const plan = structuredClone(original)
  if (job) preserveNamedSkillSignals(plan, job)
  const facts = new Map(plan.facts.map(fact => [fact.evidenceId, fact]))
  const representativeSlotIds: string[] = []
  for (const slot of plan.blueprint.slots.filter(slot => slot.kind === 'business_bullet')) {
    const core = plan.coreEvidenceIdsBySlot[slot.slotId] ?? []
    const guide = plan.editorial?.slots[slot.slotId]
    if (!guide || core.length !== 1 || facts.get(core[0])?.claimType !== 'responsibility') continue
    const practice = guide.priorityEvidenceIds?.find(id => slot.allowedEvidenceIds.includes(id)
      && facts.get(id)?.scopeId === slot.scopeId && !facts.get(id)?.contextForEvidenceId
      && ['action', 'deliverable'].includes(facts.get(id)?.claimType ?? ''))
    if (!practice) continue
    // The duty remains available as context; the selected action carries the paragraph.
    plan.coreEvidenceIdsBySlot[slot.slotId] = [practice]
    guide.role = 'contribution'
    representativeSlotIds.push(slot.slotId)
  }
  const summary = plan.blueprint.slots.find(slot => slot.kind === 'summary')
  // One existing responsibility provides career context, not a third skills catalogue.
  const backgroundEvidenceId = plan.blueprint.slots.filter(slot => slot.kind === 'business_bullet'
    && slot.sectionKey === 'experience').flatMap(slot => slot.allowedEvidenceIds)
    .find(id => facts.get(id)?.claimType === 'responsibility' && !facts.get(id)?.contextForEvidenceId)
  if (summary && backgroundEvidenceId && !summary.allowedEvidenceIds.includes(backgroundEvidenceId)) {
    summary.allowedEvidenceIds.push(backgroundEvidenceId)
  }
  plan.blueprint.requiredBodyEvidenceIds = [...new Set(plan.blueprint.slots
    .filter(slot => slot.kind !== 'skill' && slot.kind !== 'summary')
    .flatMap(slot => plan.coreEvidenceIdsBySlot[slot.slotId] ?? []))]
  plan.documentEditorial = {
    version: STRUCTURAL_WRITING_POLICY,
    abstractBudgets: plan.blueprint.outputLanguage.toLowerCase().startsWith('zh')
      ? { unit: 'cjk_characters', summaryMax: 110, skillMax: 45 }
      : { unit: 'words', summaryMax: 65, skillMax: 30 },
    sectionRoles: { summary: '定位加一项主优势，可补一项互补优势；背景替代清单，不追加清单。',
      work: '岗位范围与代表贡献；详情放在相应项目，不能混合项目身份。',
      project: '问题、实际行动与源文已有交付或阶段，不补验证结论。',
      skills: '源文工具信号由代码保留；Writer 仅简述其余方法，不复述事件。' },
    ...(summary && backgroundEvidenceId ? { backgroundEvidenceId } : {}),
    arguments: (plan.summaryThemes ?? []).slice(0, 2).map(theme => ({
      anchorEvidenceId: theme.anchorEvidenceId, targetTaskIds: theme.targetTaskIds,
      detailSlotIds: theme.detailSlotIds,
    })),
    representativeSlotIds,
  }
  return plan
}
