import { expect, test } from 'bun:test'
import { currentStrategyReview, resumeTextFingerprint } from '@/shared/resume-strategy'
import { createV5ResultFixture } from './fixtures'
import { createTargetingFixture } from './targeting-fixtures'
import { buildWritingPlan } from '@/v5/writing/plan'
import { buildEntryWritingPlan, compileEntryWriting, entryWritingPayload } from '@/v5/writing/entries'
import { assignEntryStrategyActions, buildStrategyActionPlan, buildStrategyReview, completeEntryStrategyEvidence } from '@/v5/writing/strategy-outcomes'
import { writeValidatedEntries } from '@/v5/writing/entry-correction'
import { SupportedWritingError } from '@/v5/writing/compiler'
import { buildWritingFact, writingIssue } from '@/v5/writing/facts'
import type { EvidenceAtom, V5MatchAnalysis } from '@/v5/types'

function fixture() {
  const result = createV5ResultFixture(), target = createTargetingFixture()
  const targeting = { profile: target.candidate.jobSuccessProfile, targets: target.targets, fit: target.fit }
  const base = buildWritingPlan({ resume: result.resumeEvidenceBundle, plan: result.resumePlan, policy: result.generationPolicy,
    job: result.jobRequirementBundle, match: result.matchAnalysis, targeting, editorialPolicy: 'document-editorial-v1' })
  const entryPlan = buildEntryWritingPlan({ base, resume: result.resumeEvidenceBundle, plan: result.resumePlan, policy: result.generationPolicy })
  const match: V5MatchAnalysis = { ...result.matchAnalysis, gaps: [{ gapId: 'target_gap_job:task:t1', priority: 'high',
    evidenceType: 'implicit_evidence', evidenceIds: [target.business.evidenceId], requirementIds: [target.targets[0].requirementIds[0]],
    impact: '需要说明交付边界。', safeHandling: target.fit.links[0].expressionAngle }] }
  const actions = buildStrategyActionPlan({ match, resume: result.resumeEvidenceBundle, entryPlan })
  const output = { contractVersion: 'entry-writing-v1' as const, entries: entryPlan.entries.map(entry => {
    const fact = entry.facts.find(fact => entry.coreEvidenceIds.includes(fact.evidenceId)) ?? entry.facts[0]
    return { entryId: entry.entryId, paragraphs: [{ role: 'detail' as const, text: fact.text, evidenceIds: [fact.evidenceId] }] }
  }) }
  return { result, target, match, entryPlan, actions, output }
}

test('bounded actions reach only their owning business entry without expanding facts or model output', () => {
  const f = fixture(), before = structuredClone(f.entryPlan)
  expect(f.actions.items[0].state).toBe('scheduled')
  const bound = assignEntryStrategyActions(f.entryPlan, f.actions)
  const payload = entryWritingPayload(bound)
  const assigned = payload.entries.filter(entry => entry.strategyActions?.length)
  expect(assigned).toHaveLength(1)
  expect(assigned[0].section).not.toBe('summary')
  expect(assigned[0].strategyActions![0]).toMatchObject({strategyId: `strategy_${f.match.gaps[0].gapId}`,
    instruction: f.match.gaps[0].safeHandling, targetIds: ['job:task:t1']})
  expect(assigned[0].strategyActions![0].evidenceIds.every(id => assigned[0].facts.some(fact => fact.evidenceId === id))).toBe(true)
  expect(f.entryPlan).toEqual(before)
  expect(bound.entries.map(entry => entry.facts)).toEqual(before.entries.map(entry => entry.facts))
})

test('selects the highest priority three executable actions and records the rest honestly', () => {
  const f = fixture(), targeting = f.entryPlan.base.targeting!
  const target = targeting.targets.find(item => item.id === 'job:task:t1')!
  const link = targeting.fit.links.find(item => item.targetId === target.id)!
  f.match.gaps = ['low','high','medium','high'].map((priority,index) => {
    const id = `job:task:priority${index}`
    targeting.targets.push({...target,id})
    targeting.fit.links.push({...link,targetId:id})
    return {...f.match.gaps[0],gapId:`target_gap_${id}`,priority:priority as 'low'|'high'|'medium'}
  })
  const actions = buildStrategyActionPlan({match:f.match,resume:f.result.resumeEvidenceBundle,entryPlan:f.entryPlan})
  expect(actions.items.filter(item => item.state === 'scheduled').map(item => item.strategyId))
    .toEqual(['strategy_target_gap_job:task:priority1','strategy_target_gap_job:task:priority3','strategy_target_gap_job:task:priority2'])
  expect(actions.items.find(item => item.strategyId.endsWith('priority0'))).toMatchObject({state:'not_selected'})
  const payload = entryWritingPayload(assignEntryStrategyActions(f.entryPlan,actions))
  expect(payload.entries.flatMap(entry => entry.strategyActions ?? [])).toHaveLength(3)
})

test('distinguishes missing material from evidence omitted by the existing plan and never fills a quota', () => {
  const f = fixture()
  const missing = buildStrategyActionPlan({match:{...f.match,gaps:[{...f.match.gaps[0],evidenceIds:[]}]},
    resume:f.result.resumeEvidenceBundle,entryPlan:f.entryPlan})
  expect(missing.items[0].state).toBe('needs_material')
  const noBusiness = {...f.entryPlan,entries:f.entryPlan.entries.filter(entry => entry.slot.kind !== 'business_bullet')}
  const omitted = buildStrategyActionPlan({match:f.match,resume:f.result.resumeEvidenceBundle,entryPlan:noBusiness})
  expect(omitted.items[0]).toMatchObject({state:'not_selected'})
  expect(omitted.items[0].explanation).not.toContain('篇幅')
  const confirmation = buildStrategyActionPlan({match:{...f.match,gaps:[{...f.match.gaps[0],safeHandling:'核对任职年限后补充材料。'}]},
    resume:f.result.resumeEvidenceBundle,entryPlan:f.entryPlan})
  expect(confirmation.items[0].state).toBe('needs_material')
})

test('a partially selected evidence set cannot inherit an instruction relying on other entries', () => {
  const f = fixture(), link = f.entryPlan.base.targeting!.fit.links.find(item => item.targetId === 'job:task:t1')!
  const extra = {...f.target.business,evidenceId:'other-scope-proof',sourceScopeId:'other-scope'}
  f.result.resumeEvidenceBundle.evidenceAtoms.push(extra)
  link.evidenceIds.push(extra.evidenceId)
  const actions = buildStrategyActionPlan({match:f.match,resume:f.result.resumeEvidenceBundle,entryPlan:f.entryPlan})
  expect(actions.items[0].state).toBe('not_selected')
})

test('links final exact body claims and positions without certifying semantic completion', () => {
  const f = fixture()
  const compiled = compileEntryWriting({output:f.output,entryPlan:f.entryPlan,resume:f.result.resumeEvidenceBundle,policy:f.result.generationPolicy})
  const review = buildStrategyReview({plan:f.actions,artifact:compiled.artifact,paragraphs:compiled.entryParagraphReferences})
  expect(review.items[0].status).toBe('linked')
  expect(review.resumeFingerprint).toBe(resumeTextFingerprint(compiled.artifact.markdown))
  expect(review.items[0].references.length).toBeGreaterThan(0)
  for (const reference of review.items[0].references) {
    expect(reference.location).toContain('第1段')
    expect(compiled.artifact.markdown).toContain(reference.quote)
    expect(compiled.artifact.claims.find(claim => claim.outputPath === reference.outputPath)?.outputText).toBe(reference.quote)
  }
  expect(review.items[0].explanation).toBe('本次对应正文如下，可对照查看具体表达。')
  expect(currentStrategyReview(review,compiled.artifact.markdown+'\n人工新增内容')).toBeUndefined()
})

test.each(['wrong_entry','missing_text','summary_only','duplicate_path','no_citation'] as const)('%s never supplies a misleading final reference', variant => {
  const f = fixture(), compiled = compileEntryWriting({output:f.output,entryPlan:f.entryPlan,resume:f.result.resumeEvidenceBundle,policy:f.result.generationPolicy})
  const assignment = f.actions.items[0].assignment!
  const paragraphs = compiled.entryParagraphReferences.filter(item => item.entryId === assignment.entryId)
  const paths = new Set(paragraphs.map(item => item.outputPath))
  if (variant === 'wrong_entry') paragraphs.forEach(item => {item.entryId='entry:foreign'})
  if (variant === 'missing_text') compiled.artifact.markdown='不包含之前的正文'
  if (variant === 'summary_only') compiled.artifact.claims.forEach(claim => {if(paths.has(claim.outputPath)) claim.outputPath='summary'})
  if (variant === 'duplicate_path') compiled.artifact.claims.push(...structuredClone(compiled.artifact.claims.filter(claim=>paths.has(claim.outputPath))))
  if (variant === 'no_citation') compiled.artifact.claims.forEach(claim => {claim.evidenceIds=[]})
  const review = buildStrategyReview({plan:f.actions,artifact:compiled.artifact,paragraphs})
  expect(review.items[0]).toMatchObject({status:'not_located',references:[]})
})

test('references use the final normalized text rather than the model draft', () => {
  const f=fixture(), assignment=f.actions.items[0].assignment!
  const paragraph=f.output.entries.find(entry=>entry.entryId===assignment.entryId)!.paragraphs[0]
  const atom=f.result.resumeEvidenceBundle.evidenceAtoms.find(atom=>atom.evidenceId===paragraph.evidenceIds[0])!
  atom.verbatimText='参与团队完成产品迭代。'
  paragraph.text='主导完成团队产品迭代。'
  const compiled=compileEntryWriting({output:f.output,entryPlan:f.entryPlan,resume:f.result.resumeEvidenceBundle,policy:f.result.generationPolicy})
  const review=buildStrategyReview({plan:f.actions,artifact:compiled.artifact,paragraphs:compiled.entryParagraphReferences})
  expect(review.items[0].references[0].quote).toBe('- 完成团队产品迭代。')
  expect(review.items[0].references[0].quote).not.toContain('主导')
  expect(paragraph.text).toBe('主导完成团队产品迭代。')
})

test('lossless paragraph compaction updates the reference location and retains both sentences', () => {
  const f=fixture(), assignment=f.actions.items[0].assignment!
  const entry=f.output.entries.find(entry=>entry.entryId===assignment.entryId)!
  const ids=entry.paragraphs[0].evidenceIds
  entry.paragraphs=[{role:'detail',text:'参与团队产品迭代。',evidenceIds:ids},
    {role:'detail',text:'团队交付3个功能。',evidenceIds:ids}]
  f.entryPlan.listItemHardLimit=f.entryPlan.entries.filter(entry=>entry.section!=='summary').length
  const compiled=compileEntryWriting({output:f.output,entryPlan:f.entryPlan,resume:f.result.resumeEvidenceBundle,policy:f.result.generationPolicy})
  expect(compiled.writingIssues.some(issue=>issue.code==='WRITER_LAYOUT_COMPACTED')).toBe(true)
  const item=buildStrategyReview({plan:f.actions,artifact:compiled.artifact,paragraphs:compiled.entryParagraphReferences}).items[0]
  expect(item.references).toHaveLength(1)
  expect(item.references[0]).toMatchObject({quote:'- 参与团队产品迭代。 团队交付3个功能。'})
  expect(item.references[0].location).toContain('第1段')
})

test('existing bounded correction keeps scoped actions and builds references from corrected output', async () => {
  const f = fixture(), plan=assignEntryStrategyActions(f.entryPlan,f.actions)
  const action = f.actions.items[0].assignment!, calls: Array<ReturnType<typeof entryWritingPayload>>=[]
  const result=await writeValidatedEntries({plan,write:async payload=>{
    calls.push(payload)
    return {...f.output,entries:f.output.entries.filter(entry=>payload.requiredEntryIds.includes(entry.entryId))}
  },validate:output=>{
    if(calls.length===1) throw new SupportedWritingError([writingIssue('WRITER_NUMBER_CHANGED',`${action.entryId}:p0`,[], '数量错误')])
    return compileEntryWriting({output,entryPlan:plan,resume:f.result.resumeEvidenceBundle,policy:f.result.generationPolicy})
  }})
  expect(calls).toHaveLength(2)
  expect(calls[1].entries).toHaveLength(1)
  expect(calls[1].entries[0].strategyActions?.[0].strategyId).toBe(action.strategyId)
  expect(buildStrategyReview({plan:f.actions,artifact:result.result.artifact,paragraphs:result.result.entryParagraphReferences}).items[0].status).toBe('linked')
})

test('missing targeting does not invent a material deficiency', () => {
  const f = fixture()
  f.entryPlan.base.targeting = undefined
  const actions = buildStrategyActionPlan({match: f.match, resume: f.result.resumeEvidenceBundle, entryPlan: f.entryPlan})
  expect(actions.items[0].state).toBe('not_selected')
  expect(actions.items[0].explanation).not.toContain('补充')
})

function boundaryFixture(claimType: 'result' | 'other' = 'result') {
  const f = fixture()
  const boundary: EvidenceAtom = {...f.target.business, evidenceId: 'strategy-stage-boundary', claimType,
    status: 'source_qualified', riskFlags: [], numericAtoms: [],
    verbatimText: '原型通过内部评审，尚未上线，未开展模型效果评测。',
    sourceSpan: {start: 10000, end: 10027}}
  f.result.resumeEvidenceBundle.evidenceAtoms.push(boundary)
  const link = f.entryPlan.base.targeting!.fit.links.find(item => item.targetId === 'job:task:t1')!
  link.evidenceIds.push(boundary.evidenceId)
  link.expressionAngle = '保留本人参与动作以及未上线、未开展评测的真实阶段。'
  f.match.gaps[0].safeHandling = link.expressionAngle
  f.match.gaps[0].evidenceIds.push(boundary.evidenceId)
  const complete = () => completeEntryStrategyEvidence({match: f.match, resume: f.result.resumeEvidenceBundle, entryPlan: f.entryPlan})
  return {...f, boundary, complete}
}

test.each(['result', 'other'] as const)('same-scope %s boundary completes the safe intent without creating an entry', claimType => {
  const f = boundaryFixture(claimType), before = structuredClone(f.entryPlan), complete = f.complete()
  const actions = buildStrategyActionPlan({match: f.match, resume: f.result.resumeEvidenceBundle, entryPlan: complete})
  const plan = assignEntryStrategyActions(complete, actions)
  const entry = plan.entries.find(item => item.strategyActions?.length)!
  expect(actions.items[0].state).toBe('scheduled')
  expect(entry.facts.find(fact => fact.evidenceId === f.boundary.evidenceId)?.boundaries)
    .toEqual(['未上线或概念阶段', '未评测或测试'])
  expect(entry.strategyBoundaryEvidenceIds).toEqual([f.boundary.evidenceId])
  expect(entry.coreEvidenceIds).toContain(f.boundary.evidenceId)
  expect(plan.base.facts.some(fact => fact.evidenceId === f.boundary.evidenceId)).toBe(true)
  expect(plan.base.expandedEvidenceIds[f.boundary.evidenceId]).toEqual([f.boundary.evidenceId])
  expect(plan.renderingPlan.scopePlans.find(scope => scope.scopeId === entry.scopeId)?.selectedEvidenceIds).toContain(f.boundary.evidenceId)
  expect(plan.entries.map(item => item.entryId)).toEqual(before.entries.map(item => item.entryId))
  expect(f.entryPlan).toEqual(before)
})

test.each(['foreign_scope', 'excluded', 'pii', 'conflicting', 'injection', 'no_entry', 'unknown'] as const)
('does not complete a strategy with %s evidence', variant => {
  const f = boundaryFixture()
  if (variant === 'foreign_scope') f.boundary.sourceScopeId = 'another-project'
  if (variant === 'excluded') f.boundary.status = 'excluded'
  if (variant === 'pii') f.boundary.riskFlags = ['sensitive_pii']
  if (variant === 'conflicting') f.boundary.riskFlags = ['conflicting']
  if (variant === 'injection') f.boundary.riskFlags = ['prompt_injection_like_text']
  if (variant === 'no_entry') f.entryPlan.entries = f.entryPlan.entries.filter(entry => entry.slot.kind !== 'business_bullet')
  if (variant === 'unknown') f.result.resumeEvidenceBundle.evidenceAtoms = f.result.resumeEvidenceBundle.evidenceAtoms.filter(atom => atom !== f.boundary)
  const plan = f.complete()
  expect(plan.entries.every(entry => entry.facts.every(fact => fact.evidenceId !== f.boundary.evidenceId))).toBe(true)
  expect(buildStrategyActionPlan({match: f.match, resume: f.result.resumeEvidenceBundle, entryPlan: plan}).items[0].state).not.toBe('scheduled')
})

test('only the three highest priority executable strategies may complete their retained entry material', () => {
  const f = boundaryFixture(), targeting = f.entryPlan.base.targeting!
  const target = targeting.targets[0], link = targeting.fit.links.find(item => item.targetId === target.id)!
  f.match.gaps = []
  const ids = ['low', 'high', 'medium', 'high'].map((priority, index) => {
    const id = `job:task:completion${index}`, atom = {...f.boundary, evidenceId: `boundary-${index}`}
    f.result.resumeEvidenceBundle.evidenceAtoms.push(atom)
    targeting.targets.push({...target, id})
    targeting.fit.links.push({...link, targetId: id, evidenceIds: [f.target.business.evidenceId, atom.evidenceId]})
    f.match.gaps.push({...fixture().match.gaps[0], gapId: `target_gap_${id}`, safeHandling: link.expressionAngle,
      evidenceIds: [f.target.business.evidenceId, atom.evidenceId], priority: priority as 'low' | 'medium' | 'high'})
    return atom.evidenceId
  })
  const plan = f.complete(), added = plan.entries.flatMap(entry => entry.strategyBoundaryEvidenceIds ?? [])
  expect(added).toEqual([ids[1], ids[3], ids[2]])
  expect(plan.entries.flatMap(entry => entry.facts.map(fact => fact.evidenceId))).not.toContain(ids[0])
  expect(buildStrategyActionPlan({match: f.match, resume: f.result.resumeEvidenceBundle, entryPlan: plan})
    .items.filter(item => item.state === 'scheduled')).toHaveLength(3)
})

test('adopting the practice without its completed boundary uses only the existing bounded correction', async () => {
  const f = boundaryFixture(), complete = f.complete()
  const actions = buildStrategyActionPlan({match: f.match, resume: f.result.resumeEvidenceBundle, entryPlan: complete})
  const plan = assignEntryStrategyActions(complete, actions), calls: unknown[] = []
  const actionEntry = plan.entries.find(entry => entry.strategyActions?.length)!
  const validate = (output: unknown) => compileEntryWriting({output, entryPlan: plan, resume: f.result.resumeEvidenceBundle, policy: f.result.generationPolicy})
  const delivered = await writeValidatedEntries({plan, write: async payload => {
    calls.push(payload)
    return {...f.output, entries: f.output.entries.filter(entry => payload.requiredEntryIds.includes(entry.entryId)).map(entry => {
      if (calls.length === 1 || entry.entryId !== actionEntry.entryId) return entry
      return {...entry, paragraphs: [...entry.paragraphs, {role: 'detail' as const,
        text: '原型通过内部评审，未发布，也未进行模型效果测试。', evidenceIds: [f.boundary.evidenceId]}]}
    })}
  }, validate})
  expect(calls).toHaveLength(2)
  expect(delivered.repairAttempts).toBe(1)
  expect(delivered.result.artifact.markdown).toContain('未发布，也未进行模型效果测试')
  expect(buildStrategyReview({plan: actions, artifact: delivered.result.artifact,
    paragraphs: delivered.result.entryParagraphReferences}).items[0].status).toBe('linked')
})

test('citing all action evidence or saying prototype design cannot conceal an omitted explicit boundary', () => {
  const f = boundaryFixture(), complete = f.complete()
  const actions = buildStrategyActionPlan({match: f.match, resume: f.result.resumeEvidenceBundle, entryPlan: complete})
  const plan = assignEntryStrategyActions(complete, actions)
  const output = structuredClone(f.output), written = output.entries.find(entry => entry.entryId === actions.items[0].assignment!.entryId)!
  written.paragraphs[0].text += ' 原型方案设计。'
  written.paragraphs[0].evidenceIds.push(f.boundary.evidenceId)
  expect(() => compileEntryWriting({output, entryPlan: plan, resume: f.result.resumeEvidenceBundle, policy: f.result.generationPolicy}))
    .toThrow(SupportedWritingError)
})

test('an action not adopted in actual prose does not add correction or block safe content', async () => {
  const f = boundaryFixture(), complete = f.complete()
  const actions = buildStrategyActionPlan({match: f.match, resume: f.result.resumeEvidenceBundle, entryPlan: complete})
  const plan = assignEntryStrategyActions(complete, actions), owner = plan.entries.find(entry => entry.strategyActions?.length)!
  const other = {...f.target.business, evidenceId: 'another-safe-action', verbatimText: '整理用户反馈并跟进问题。',
    claimType: 'action' as const, riskFlags: [], numericAtoms: []}
  f.result.resumeEvidenceBundle.evidenceAtoms.push(other)
  const fact = {...owner.facts[0], evidenceId: other.evidenceId, text: other.verbatimText, boundaries: [], protectedNumbers: [], requiredNumbers: []}
  owner.facts.push(fact)
  plan.base.facts.push(fact)
  plan.base.expandedEvidenceIds[other.evidenceId] = [other.evidenceId]
  const output = {...f.output, entries: f.output.entries.map(entry => entry.entryId === owner.entryId ? {...entry,
    paragraphs: [{role: 'detail' as const, text: other.verbatimText, evidenceIds: [other.evidenceId]}]} : entry)}
  let calls = 0
  const delivered = await writeValidatedEntries({plan, write: async () => {calls++; return output}, validate: value =>
    compileEntryWriting({output: value, entryPlan: plan, resume: f.result.resumeEvidenceBundle, policy: f.result.generationPolicy})})
  expect(calls).toBe(1)
  expect(buildStrategyReview({plan: actions, artifact: delivered.result.artifact,
    paragraphs: delivered.result.entryParagraphReferences}).items[0].status).toBe('not_located')
})

test('a compound practice already carrying one boundary still requires its added evaluation boundary', () => {
  const f = boundaryFixture()
  f.result.resumeEvidenceBundle.evidenceAtoms.find(atom => atom.evidenceId === f.target.business.evidenceId)!.verbatimText += ' 尚未上线。'
  const complete = f.complete(), actions = buildStrategyActionPlan({match: f.match, resume: f.result.resumeEvidenceBundle, entryPlan: complete})
  const plan = assignEntryStrategyActions(complete, actions), output = structuredClone(f.output)
  output.entries.find(entry => entry.entryId === actions.items[0].assignment!.entryId)!.paragraphs[0].text += ' 尚未上线。'
  let issues: string[] = []
  try { compileEntryWriting({output, entryPlan: plan, resume: f.result.resumeEvidenceBundle, policy: f.result.generationPolicy}) }
  catch (error) { if (error instanceof SupportedWritingError) issues = error.issues.map(issue => issue.message); else throw error }
  expect(issues).toContain('正文未保留来源中的未评测或测试边界。')
})

test('completion preserves existing same-scope source expansion and does not dereference synthetic fact IDs', () => {
  const f = boundaryFixture()
  const companion = {...f.boundary, evidenceId: 'boundary-companion', verbatimText: '评审范围限于内部方案。'}
  f.result.resumeEvidenceBundle.evidenceAtoms.push(companion)
  const existing = {...buildWritingFact(f.boundary)!, contextRole: 'stage' as const}
  f.entryPlan.base.facts.push(existing)
  f.entryPlan.base.expandedEvidenceIds[f.boundary.evidenceId] = [f.boundary.evidenceId, companion.evidenceId]
  f.entryPlan.entries.find(entry => entry.slot.kind === 'business_bullet')!.facts.push({...existing, evidenceId: 'synthetic-existing'})
  const completed = f.complete()
  expect(completed.base.expandedEvidenceIds[f.boundary.evidenceId]).toEqual([f.boundary.evidenceId, companion.evidenceId])
  expect(completed.base.facts.find(fact => fact.evidenceId === f.boundary.evidenceId)).toEqual(existing)
  expect(completed.entries.flatMap(entry => entry.facts).find(fact => fact.evidenceId === f.boundary.evidenceId)?.contextRole).toBe('stage')
})

test('a pure other boundary cannot become executable practice by itself', () => {
  const f = boundaryFixture('other')
  f.entryPlan.base.targeting!.fit.links.find(link => link.targetId === 'job:task:t1')!.evidenceIds = [f.boundary.evidenceId]
  f.match.gaps[0].evidenceIds = [f.boundary.evidenceId]
  const plan = f.complete()
  expect(plan.entries.flatMap(entry => entry.facts.map(fact => fact.evidenceId))).not.toContain(f.boundary.evidenceId)
  expect(buildStrategyActionPlan({match: f.match, resume: f.result.resumeEvidenceBundle, entryPlan: plan}).items[0].state).not.toBe('scheduled')
})
