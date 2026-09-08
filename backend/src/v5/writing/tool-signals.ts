import type { JobRequirementBundle } from '@/v5/types'
import type { WritingPlan } from '@/v5/writing/plan'

const NAMED_SKILLS = /\b(?:SQL|Excel|Python|Java|MySQL|Redis|Kafka|Spring(?:\s+Boot|\s+Cloud)?|JVM|Docker|Kubernetes|Linux|Figma|Tableau|Power\s*BI|SPSS|SAP|Jira|PRD|C\+\+|JavaScript|TypeScript)\b|用友|金蝶/giu
const signals = (text: string) => [...new Set([...text.matchAll(NAMED_SKILLS)].map(m=>m[0].replace(/\s/g,'').toLowerCase()))]

/** Retain source wording and proficiency in one existing skill slot. No inferred tool use. */
export function preserveNamedSkillSignals(plan: WritingPlan, job: JobRequirementBundle) {
  const wanted = new Set(signals(job.requirementAtoms.map(a=>a.verbatimText).join('\n')))
  const slot = plan.blueprint.slots.find(s=>s.kind === 'skill')
  if (!slot || !wanted.size) return
  const pool = plan.facts.filter(f=>f.claimType === 'skill' && !f.contextForEvidenceId && f.text.length <= 240
    && !/不会|不熟悉|未使用|从未使用|没有.{0,6}经验|\bnot\b/iu.test(f.text))
  const chosen: typeof pool = [], remaining = new Set(wanted)
  while (chosen.length < 2) {
    const ranked = pool.filter(f=>!chosen.includes(f)).map(f=>({ fact:f, covered:signals(f.text).filter(s=>remaining.has(s)) }))
      .filter(f=>f.covered.length).sort((a,b)=>b.covered.length-a.covered.length
        || a.fact.text.length-b.fact.text.length || a.fact.evidenceId.localeCompare(b.fact.evidenceId))
    if (!ranked[0]) break
    chosen.push(ranked[0].fact); ranked[0].covered.forEach(s=>remaining.delete(s))
  }
  if (!chosen.length) return
  const evidenceIds = chosen.map(f=>f.evidenceId)
  slot.scopeId = null; slot.allowedEvidenceIds = evidenceIds
  plan.coreEvidenceIdsBySlot[slot.slotId] = evidenceIds
  if (plan.skillThemes) delete plan.skillThemes[slot.slotId]
  if (plan.editorial) delete plan.editorial.slots[slot.slotId]
  plan.fixedBlocks = [{ slotId:slot.slotId, evidenceIds, text:chosen.map(f=>f.text.replace(/\s*[\r\n]+\s*/gu,'；')).join('；') }]
}
