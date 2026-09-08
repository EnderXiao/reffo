import { expect, test } from 'bun:test'
import { canonicalizeSourceDocument } from '@/v5/canonical-source'
import { buildResumeExtractionScopePlan, splitResumeDocument, normalizeResumeExtractionChunkCandidate } from '@/v5/chunked-resume-extraction'
import { createResumeFixture } from '@/v5/tests/fixtures'
import { createTargetingFixture } from '@/v5/tests/targeting-fixtures'
import { validateJobFitMap } from '@/v5/targeting/fit'
import { inspectSupportedWriting } from '@/v5/writing/facts'
import { deriveEducationIdentity, inspectEducationIdentity } from '@/v5/writing/identity'
import type { EvidenceAtom } from '@/v5/types'

test('education status comes from explicit source, never the JD or a guessed date', () => {
  const atom: EvidenceAtom = { ...createTargetingFixture().business, claimType: 'other' }
  const identity = deriveEducationIdentity([{ ...atom, verbatimText: '统计学本科应届毕业生，有数据运营实习。' }])
  expect(identity[0].state).toBe('graduated')
  expect(inspectEducationIdentity('统计学本科在读。', identity, 'summary').map(i=>i.code)).toContain('WRITER_EDUCATION_STATUS_CHANGED')
  expect(inspectEducationIdentity('统计学本科应届毕业生。', identity, 'summary')).toEqual([])
  expect(inspectEducationIdentity('硕士在读。', identity, 'summary')).toEqual([])
  expect(deriveEducationIdentity([{ ...atom, verbatimText: '本科｜2022.09 - 2026.06' }])).toEqual([])
  expect(deriveEducationIdentity([{ ...atom, verbatimText: '要求本科在读；计划硕士就读。' }])).toEqual([])
  const ambiguous = deriveEducationIdentity([{ ...atom, verbatimText: '本科毕业生；另有本科在读经历。' }])
  expect(ambiguous[0].state).toBe('unknown')
  expect(deriveEducationIdentity([{ ...atom, verbatimText: '面向本科在读学生提供辅导。' }])).toEqual([])
  expect(deriveEducationIdentity([{ ...atom, claimType:'action', verbatimText:'招募统计学本科在读学生参与调研。' }])).toEqual([])
})

test('a merged model timeline cannot lend its title and dates to the new independent project', () => {
  const document = canonicalizeSourceDocument('预测课程项目｜2024.01 - 2024.06\n- 建立预测模型。\n用户分群分析｜个人练习｜2025.09\n- 完成分群报告。').canonicalDocument
  const candidate = createResumeFixture().candidate
  const template = candidate.factCandidates[0]
  candidate.factCandidates = document.blocks.map((block,index)=>({ ...template, factLocalId:`f${index}`, sourceBlockId:block.sourceBlockId,
    verbatimText:block.text, normalizedClaim:block.text, blockRelativeSpan:{start:0,end:block.text.length},
    sourceScopeLocalId:'merged',claimType:'action' }))
  candidate.timelineCandidates = [{scopeLocalId:'merged',kind:'project',organization:'错误公司',title:'预测课程项目',start:'2024.01',end:'2024.06',factLocalIds:candidate.factCandidates.map(f=>f.factLocalId)}]
  const result = normalizeResumeExtractionChunkCandidate(splitResumeDocument(document)[0], candidate)
  const personal = result.timelineCandidates.find(t=>t.title?.includes('用户分群分析'))!
  expect(personal).toBeDefined()
  expect(personal.organization).toBeNull()
  expect(personal.start).toBeNull()
  expect(personal.end).toBeNull()
  expect(personal.factLocalIds).toEqual(['f2','f3'])
})

test.each([
  '用户分群与复购分析｜个人练习｜2025.09',
  '个人项目：短链服务｜2025.01',
  '预算预测｜课程项目｜2024/7',
])('separates an independent single-month project: %s', title => {
  const source = ['【项目经历】', '告警中心重构｜2023.09 - 2024.02', '- 优化重复告警。', title, '- 完成个人分析报告。'].join('\n')
  const document = canonicalizeSourceDocument(source).canonicalDocument
  const plan = buildResumeExtractionScopePlan(document)
  const body = document.blocks.filter(b => b.text.startsWith('- '))
  expect(plan.scopeBySourceBlockId.get(body[0].sourceBlockId)).toBeDefined()
  expect(plan.scopeBySourceBlockId.get(body[1].sourceBlockId)).toBeDefined()
  expect(plan.scopeBySourceBlockId.get(body[1].sourceBlockId)).not.toBe(plan.scopeBySourceBlockId.get(body[0].sourceBlockId))
})

test.each(['- 个人项目：增长率｜2025.01', '统计周期｜2025.01', '项目上线后，处理告警｜2025.01', '个人项目：报告｜2025.13'])('does not split metric or prose into a project: %s', line => {
  const document = canonicalizeSourceDocument(['项目实施｜2024.01 - 2024.12', '- 分析业务问题。', line, '- 形成改进方案。'].join('\n')).canonicalDocument
  const plan = buildResumeExtractionScopePlan(document)
  expect(new Set(document.blocks.map(b => plan.scopeBySourceBlockId.get(b.sourceBlockId)))).toHaveProperty('size', 1)
})

test('an unproven gap becomes unknown without preserving the accusation or mutating model output', () => {
  const f = createTargetingFixture()
  const link = f.fit.links[0]
  link.status = 'explicit_gap'; link.evidenceIds = []; link.difference = '候选人不具备增长经验。'
  const before = structuredClone(f.fit)
  const checked = validateJobFitMap(f.fit, f.targets, f.resume)
  expect(checked.passed).toBe(true)
  expect(checked.value!.links[0]).toMatchObject({ status: 'unknown', evidenceIds: [], expressionAngle: '' })
  expect(checked.value!.links[0].difference).not.toContain('不具备')
  expect(checked.issues.map(i => i.code)).toContain('JOB_FIT_UNPROVEN_GAP_ALIGNED')
  expect(f.fit).toEqual(before)
  expect(validateJobFitMap(checked.value!, f.targets, f.resume).value).toEqual(checked.value)
})

test('unsupported positive claims remain errors and evidenced gaps are retained', () => {
  const f = createTargetingFixture()
  f.fit.links[0].status = 'direct'; f.fit.links[0].evidenceIds = []
  expect(validateJobFitMap(f.fit, f.targets, f.resume).passed).toBe(false)
  f.fit.links[0].status = 'explicit_gap'; f.fit.links[0].evidenceIds = [f.business.evidenceId]
  expect(validateJobFitMap(f.fit, f.targets, f.resume).value!.links[0].status).toBe('explicit_gap')
})

test('retains explicit platform-not-personal attribution, rejecting its removal and contradiction', () => {
  const f = createTargetingFixture()
  const atom: EvidenceAtom = { ...f.business, riskFlags: ['team_attribution'], verbatimText: '上线后支撑约42万在线设备，数字为整个平台规模，并非本人模块独立承载。' }
  expect(inspectSupportedWriting(atom.verbatimText, [atom], 'project')).toEqual([])
  expect(inspectSupportedWriting('上线后支撑约42万在线设备。', [atom], 'project').map(i=>i.code)).toContain('WRITER_BOUNDARY_LOST')
  expect(inspectSupportedWriting(atom.verbatimText + '本人独立承载约42万在线设备。', [atom], 'project').map(i=>i.code)).toContain('WRITER_OWNERSHIP_UPGRADE')
})
