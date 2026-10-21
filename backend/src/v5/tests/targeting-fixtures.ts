import { createJobFixture, createResumeFixture } from '@/v5/tests/fixtures'
import type { JobFitMap, TargetedJobExtraction } from '@/v5/targeting/contracts'
import { buildJobTargets, validateTargetedJobExtraction } from '@/v5/targeting/profile'
import { buildJobRequirementBundle } from '@/v5/evidence'

export function createTargetingFixture() {
  const source = createJobFixture(), resume = createResumeFixture().bundle
  const candidate: TargetedJobExtraction = { ...source.candidate, jobSuccessProfile: {
    contractVersion: 'job-success-profile-v1', context: [],
    tasks: [{ id: 'job:task:t1', text: '产品规划与数据分析', priority: 'core', requirementLocalIds: ['r1'],
      provenance: { basis: 'explicit', sourceBlockIds: ['B0002'], reason: '', confidence: 'high' } }],
    outcomes: [],
    successConditions: [{ id: 'job:condition:c1', text: '理解需求并形成产品方案', taskIds: ['job:task:t1'],
      provenance: { basis: 'inferred', sourceBlockIds: ['B0002'], reason: '规划任务需要识别需求与形成方案。', confidence: 'medium' } }],
    attributes: [{ id: 'job:attribute:a1', text: '产品方案设计能力', dimension: 'ability', taskIds: ['job:task:t1'], conditionIds: ['job:condition:c1'],
      requirementLocalIds: [], evidenceExpectation: '本人参与的方案或交付实践',
      provenance: { basis: 'inferred', sourceBlockIds: ['B0002'], reason: '对应产品规划任务。', confidence: 'medium' } }],
    requirements: [{ requirementLocalId: 'r2', condition: 'necessary', sourceQuote: '要求熟练使用SQL' }],
    unknowns: ['业务规模和绩效数值未提供。'], conflicts: [],
  } }
  const normalized = validateTargetedJobExtraction(source.document, candidate).value!
  const job = buildJobRequirementBundle(source.document, normalized)
  const targets = buildJobTargets(normalized, job)
  const business = resume.evidenceAtoms.find(atom => atom.claimType === 'deliverable')!
  const skill = resume.evidenceAtoms.find(atom => atom.claimType === 'skill')!
  const fit: JobFitMap = { contractVersion: 'job-fit-map-v1',
    links: targets.map(target => ({ targetId: target.id, status: 'transferable',
      evidenceIds: [target.text.includes('SQL') ? skill.evidenceId : business.evidenceId],
      similarity: '有相邻产品实践。', difference: '尚不足以证明完整规划能力。', expressionAngle: '突出已参与的真实交付。' })),
    narratives: [{ statement: '具有团队产品交付实践。', targetIds: ['job:task:t1'], evidenceIds: [business.evidenceId] }], questions: [],
  }
  return { document: source.document, candidate: normalized, job, resume, targets, fit, business, skill }
}
