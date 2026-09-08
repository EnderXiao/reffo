import { describe, expect, test } from 'bun:test'
import { createV5ResultFixture } from '@/v5/tests/fixtures'
import { buildWritingFact, inspectSupportedWriting, writingDisplayText, writingNumbers } from '@/v5/writing/facts'
import { buildWritingPlan, writingPayload } from '@/v5/writing/plan'
import { compileWritingArtifact, SupportedWritingError } from '@/v5/writing/compiler'
import { validateGeneratedResumeArtifact } from '@/v5/validators'
import { compileV5Prompt } from '@/v5/prompt-compiler'
import type { P06CompositionOutput } from '@/v5/composition/contract'
import type { EvidenceAtom } from '@/v5/types'
import { parseEvaluationRunnerArgs, v5CaseOutputTokenEnvelope, v5EvaluationComponentQuotas } from '@/v5/evaluation-runner-support'

function atom(text: string): EvidenceAtom {
  const template = createV5ResultFixture().resumeEvidenceBundle.evidenceAtoms.find(atom => atom.claimType === 'deliverable')!
  return { ...template, verbatimText: text, numericAtoms: [], qualifiers: [], riskFlags: [] }
}
function context() {
  const result = createV5ResultFixture()
  const input = { resume: result.resumeEvidenceBundle, plan: result.resumePlan, policy: result.generationPolicy, match: result.matchAnalysis, job: result.jobRequirementBundle }
  const writingPlan = buildWritingPlan(input)
  const facts = new Map(writingPlan.facts.map(fact => [fact.evidenceId, fact]))
  const composition: P06CompositionOutput = {
    contractVersion: writingPlan.blueprint.contractVersion,
    blocks: writingPlan.blueprint.slots.map(slot => ({
      slotId: slot.slotId,
      evidenceIds: slot.allowedEvidenceIds.slice(0, 1),
      text: slot.kind === 'summary' ? '参与团队产品迭代，具有功能交付实践。'
        : facts.get(slot.allowedEvidenceIds[0])!.text.replace('参与团队产品迭代，交付3个功能。', '参与团队产品迭代并交付3个功能。'),
    })),
  }
  return { ...input, writingPlan, composition }
}

describe('supported writing facts and contract', () => {
  test('allows source-backed summary numbers but still rejects invented totals', () => {
    const input = context()
    const fact = input.writingPlan.facts.find(f => f.text.includes('交付3个功能'))!
    const summary = { slotId: 'summary:0', evidenceIds: [fact.evidenceId], text: '参与团队产品迭代，交付3个功能。' }
    input.writingPlan.blueprint.slots.unshift({ slotId: 'summary:0', kind: 'summary', sectionKey: 'summary', scopeId: null,
      outputPath: 'summary[0]', order: -1, required: true, allowedEvidenceIds: [fact.evidenceId] })
    input.writingPlan.blueprint.sectionOrder.unshift('summary')
    input.writingPlan.coreEvidenceIdsBySlot['summary:0'] = []
    input.composition.blocks.unshift(summary)
    expect(() => compileWritingArtifact(input)).not.toThrow()
    summary.text = '参与团队产品迭代，累计交付30个功能。'
    try { compileWritingArtifact(input); throw new Error('expected validation error') }
    catch (error) { expect((error as SupportedWritingError).issues.map(i => i.code)).toContain('WRITER_NUMBER_CHANGED') }
  })
  test('recognizes source-supported reverse collaboration phrases without inferring departments from product development', () => {
    expect(inspectSupportedWriting('跨部门交付：协同研发、设计、商务、宣发团队。', [
      atom('方案设计、研发协同、上线落地。'), atom('联动设计、商务和宣发支持功能发布。'),
    ], 'skills[0]')).toEqual([])
    expect(inspectSupportedWriting('协同研发完成任务。', [atom('产品开发设计。')], 'skills[0]').map(issue => issue.code)).toContain('WRITER_COLLABORATOR_ADDED')
    expect(inspectSupportedWriting('协同研发、商务完成任务。', [atom('研发协同。')], 'skills[0]').map(issue => issue.code)).toContain('WRITER_COLLABORATOR_ADDED')
  })
  test('recognizes cross-functional delivery as collective work without allowing ownership upgrades', () => {
    const source = atom('参与团队产品交付。')
    source.riskFlags = ['team_attribution']
    expect(inspectSupportedWriting('具有跨部门交付实践。', [source], 'summary[0]')).toEqual([])
    expect(inspectSupportedWriting('具有产品交付实践。', [source], 'summary[0]').map(issue => issue.code)).toContain('WRITER_BOUNDARY_LOST')
    expect(inspectSupportedWriting('跨部门交付中独立完成全部工作。', [source], 'summary[0]').map(issue => issue.code)).toContain('WRITER_OWNERSHIP_UPGRADE')
  })
  test('Writer receives team boundaries recorded in evidence metadata, not only lexical source phrases', () => {
    const source = atom('平均每两周发布一个版本。')
    source.riskFlags = ['team_attribution']
    expect(buildWritingFact(source)?.boundaries).toContain('团队或参与贡献')
    expect(inspectSupportedWriting('平均每两周发布一个版本。', [source], 'summary[0]').map(i => i.code)).toContain('WRITER_BOUNDARY_LOST')
    expect(inspectSupportedWriting('协同团队平均每两周发布一个版本。', [source], 'summary[0]').map(i => i.code)).not.toContain('WRITER_BOUNDARY_LOST')
  })

  test('rejects an unfinished metric even when its evidence references are valid', () => {
    const input = context()
    const block = input.composition.blocks.find(b => input.writingPlan.blueprint.slots.find(s => s.slotId === b.slotId)?.kind !== 'summary')!
    block.text = '参与团队产品迭代并交付3个功能，覆盖率提升至'
    try { compileWritingArtifact(input); throw new Error('expected writer validation error') }
    catch (error) {
      expect(error).toBeInstanceOf(SupportedWritingError)
      expect((error as SupportedWritingError).issues.some(i => i.code === 'WRITER_INCOMPLETE_METRIC')).toBe(true)
    }
    expect(() => compileWritingArtifact(context())).not.toThrow()
  })

  test('Writer preflight reserves the actual P06C allowance and never authorizes both writers', () => {
    const shape = { validatedShardIndexes: [0], artifactGenerationMode: 'writer_v1' as const }
    expect(v5EvaluationComponentQuotas(1, 'generation-only', shape)).toEqual({ P02: 1, P02R: 1, P03: 1, P03R: 1, P04: 1, P06C: 1 })
    const writer = v5CaseOutputTokenEnvelope(1, 'generation-only', shape)
    const dsl = v5CaseOutputTokenEnvelope(1, 'generation-only', { validatedShardIndexes: [0] })
    expect(writer.totalTokens - dsl.totalTokens).toBe(1800)
    expect(parseEvaluationRunnerArgs(['--artifact-mode', 'writer_v1'], { backendRoot: '/repo/backend' }).artifactGenerationMode).toBe('writer_v1')
    expect(parseEvaluationRunnerArgs([], { backendRoot: '/repo/backend' }).artifactGenerationMode).toBe('dsl_v1')
  })
  test('projects confirmation wording without losing approval or date', () => {
    const source = atom('晋升于2026-07-29经本人确认已获批准。')
    const before = structuredClone(source)
    expect(buildWritingFact(source)?.text).toBe('晋升于2026-07-29已获批准。')
    expect(source).toEqual(before)
    expect(writingDisplayText('尚未上线，不写商业收益或规模化结果。')).toBe('尚未上线。')
  })

  test('does not erase unrecognized editorial or uncertain qualifications', () => {
    expect(buildWritingFact(atom('可能尚未上线，投递前需本人确认。'))).toBeNull()
    expect(buildWritingFact(atom('参与概念方案设计，尚未上线。'))?.text).toContain('尚未上线')
  })
  test('removes only explicit provenance labels while retaining numbers and uncertainty', () => {
    const source = atom('交付产品，个人简历记录iOS日活200K，尚未验证。')
    const before = structuredClone(source)
    expect(writingDisplayText(source.verbatimText)).toBe('交付产品，iOS日活200K，尚未验证。')
    expect(source).toEqual(before)
    expect(writingDisplayText('可能达到200K，个人仍需确认。')).toContain('可能')
  })

  test.each([
    ['回收400+份问卷。', '回收400份问卷。', 'WRITER_NUMBER_CHANGED'],
    ['获得约367份有效样本。', '获得367份有效样本。', 'WRITER_NUMBER_CHANGED'],
    ['访谈20人。', '访谈20次。', 'WRITER_NUMBER_CHANGED'],
    ['服务≥20家企业。', '服务20家企业。', 'WRITER_NUMBER_CHANGED'],
    ['交付3个功能。', '交付30个功能。', 'WRITER_NUMBER_CHANGED'],
    ['负责需求整理。', '使用Python整理需求。', 'WRITER_UNSUPPORTED_TOOL'],
    ['负责需求整理。', '输出PRD。', 'WRITER_UNSUPPORTED_TOOL'],
    ['参与设计方案，尚未上线。', '设计功能并上线。', 'WRITER_BOUNDARY_LOST'],
    ['仅参与团队完成迭代。', '完成迭代。', 'WRITER_BOUNDARY_LOST'],
    ['没有负责上线。', '负责上线。', 'WRITER_NEGATION_LOST'],
    ['未使用Python。', '使用Python。', 'WRITER_NEGATION_LOST'],
    ['晋升已获批准。', '已经晋升并履任。', 'WRITER_BOUNDARY_LOST'],
    ['使用SQL。', '精通SQL。', 'WRITER_PROFICIENCY_UPGRADE'],
    ['负责产品方案。', '独立完成产品方案。', 'WRITER_OWNERSHIP_UPGRADE'],
    ['协同研发推进迭代。', '协同研发、设计、市场、运营推进迭代。', 'WRITER_COLLABORATOR_ADDED'],
    ['服务200K用户。', '服务200用户。', 'WRITER_NUMBER_CHANGED'],
    ['服务200用户。', '服务200K用户。', 'WRITER_NUMBER_CHANGED'],
    ['服务2M用户。', '服务2K用户。', 'WRITER_NUMBER_CHANGED'],
    ['进行需求整理。', '进行需求整理，经本人确认。', 'WRITER_EDITORIAL_LEAK'],
  ])('rejects the known boundary change: %s -> %s', (source, output, code) => {
    expect(inspectSupportedWriting(output, [atom(source)], 'body').map(issue => issue.code)).toContain(code)
  })

  test('allows professional expression and supported numbers without lexical equality', () => {
    expect(inspectSupportedWriting('负责需求梳理与研发沟通，支持团队理解需求重点。', [atom('负责需求整理，和研发沟通。')], 'body')).toEqual([])
    expect(inspectSupportedWriting('参与访谈，覆盖约20人。', [atom('参与访谈约20人。')], 'body')).toEqual([])
    expect(writingNumbers('回收400+份，367份有效。')).toEqual(['400+份', '367份'])
  })

  test.each([
    ['协同开发、设计、测试推动上线。', '协同研发、设计、测试等团队推进交付。'],
    ['与研发部门沟通需求。', '与开发团队对齐需求。'],
  ])('allows bounded collaboration aliases: %s', (source, output) => {
    expect(inspectSupportedWriting(output, [atom(source)], 'body')).toEqual([])
  })
  test.each([
    ['协同开发、测试。', '协同研发、运营、测试。'],
    ['负责产品开发。', '协同研发团队。'],
    ['协同研发。', '协同研发和市场。'],
  ])('does not invent a collaborator through alias normalization: %s', (source, output) => {
    expect(inspectSupportedWriting(output, [atom(source)], 'body').map(issue => issue.code)).toContain('WRITER_COLLABORATOR_ADDED')
  })

  test('approval boundaries only qualify a promotion claim, not unrelated duties', () => {
    const source = atom('负责企业服务产品，晋升于2026-07-29已获批准。')
    expect(inspectSupportedWriting('具有企业服务产品经验。', [source], 'summary')).toEqual([])
    expect(inspectSupportedWriting('负责企业服务产品。', [source], 'body')).toEqual([])
    expect(inspectSupportedWriting('已晋升并履任。', [source], 'body').map(issue => issue.code)).toContain('WRITER_BOUNDARY_LOST')
  })

  test('priority/count spacing is equivalent but swapping counts is not', () => {
    const source = atom('PRD形成20条需求，其中P010条、P14条、P26条。')
    expect(inspectSupportedWriting('PRD包含20条需求：P0 10条、P1 4条、P2 6条。', [source], 'body')).toEqual([])
    expect(inspectSupportedWriting('PRD包含20条需求：P0 4条、P1 10条、P2 6条。', [source], 'body').map(issue => issue.code)).toContain('WRITER_NUMBER_CHANGED')
    expect(writingNumbers('P01阶段有10条需求。')).toEqual(['01', '10条'])
  })

  test('protects scale suffixes, case, counts and memory units without stripping magnitude', () => {
    expect(writingNumbers('200K，2M，3B，200k+，25%，30万，40MB，5ms。')).toEqual(['200k', '2m', '3b', '200k+', '25%', '30万', '40mb', '5ms'])
    expect(inspectSupportedWriting('协同研发与设计推动方案。', [atom('与研发、设计对齐方案。')], 'body')).toEqual([])
    expect(inspectSupportedWriting('独立完成方案设计。', [atom('独立完成产品方案。')], 'body')).toEqual([])
  })

  test('focus obligation does not turn every incidental number into a required result', () => {
    const input = context()
    const block = input.composition.blocks.find(block => !block.slotId.startsWith('summary'))!
    const id = block.evidenceIds[0]
    const source = input.resume.evidenceAtoms.find(atom => atom.evidenceId === id)!
    source.verbatimText = '参与团队产品迭代，交付3个功能；产品日活200K。'
    input.writingPlan.facts[input.writingPlan.facts.findIndex(fact => fact.evidenceId === id)] = buildWritingFact(source)!
    block.text = '参与团队产品迭代，交付3个功能。'
    const compiled = compileWritingArtifact(input)
    expect(compiled.writingIssues).toMatchObject([{ code: 'WRITER_SUPPORTING_DETAIL_OMITTED', severity: 'warning' }])
    block.text = '参与团队产品迭代，交付3个功能；产品日活200。'
    expect(() => compileWritingArtifact(input)).toThrow(SupportedWritingError)
    block.text = '参与团队产品迭代。'
    expect(() => compileWritingArtifact(input)).toThrow(SupportedWritingError)
  })

  test('renders a supported paraphrase through the real artifact validator', () => {
    const input = context()
    const { artifact } = compileWritingArtifact(input)
    expect(artifact.markdown).toContain('参与团队产品迭代并交付3个功能。')
    expect(artifact.claims.some(claim => claim.transformation === 'safe_paraphrase')).toBe(true)
    const validation = validateGeneratedResumeArtifact({ ...input, artifact, gateMode: 'relaxed_release', textPolicy: 'supported_writing_v1' })
    expect(validation.issues.filter(issue => issue.severity === 'error')).toEqual([])
    expect(validation.passed).toBe(true)
    const legacy = validateGeneratedResumeArtifact({ ...input, artifact, gateMode: 'relaxed_release' })
    expect(legacy.issues.some(issue => issue.code === 'UNPROVABLE_CLAIM_TEXT')).toBe(true)
  })

  test('a preferred later result is advisory and does not become another blocking rewrite gate', () => {
    const input = context()
    const block = input.composition.blocks.find(block => !block.slotId.startsWith('summary'))!
    const source = input.resume.evidenceAtoms.find(atom => atom.evidenceId === block.evidenceIds[0])!
    source.verbatimText += '转化率提升15%。'
    input.writingPlan.editorial = { version: 'writing-editorial-v4', slots: { [block.slotId]: {
      role: 'contribution', targetTaskIds: [], emphasis: [{ evidenceId: source.evidenceId, text: '转化率提升15%。', kind: 'outcome' }],
      lengthHint: { unit: 'cjk_characters', target: 10, max: 15 }, avoidRepeatingSlotIds: [], priorityEvidenceIds: ['optional-practice'],
    } } }
    const compiled = compileWritingArtifact(input)
    expect(compiled.writingIssues).toContainEqual(expect.objectContaining({code: 'WRITER_PRIORITY_OUTCOME_OMITTED', severity: 'warning'}))
    expect(compiled.writingIssues).toContainEqual(expect.objectContaining({code: 'WRITER_PRIORITY_PRACTICE_OMITTED', severity: 'warning'}))
    expect(compiled.artifact.markdown).toContain('交付3个功能')
  })

  test('server ordering ignores model completion order', () => {
    const input = context()
    const first = compileWritingArtifact(input).artifact
    input.composition.blocks.reverse()
    expect(compileWritingArtifact(input).artifact).toEqual(first)
  })

  test.each(['duplicate_slot', 'unknown_evidence', 'missing_slot', 'new_number', 'markdown', 'missing_core_result'] as const)('rejects %s without repairing or dropping content', mutation => {
    const input = context()
    const block = input.composition.blocks.find(block => !block.slotId.startsWith('summary'))!
    if (mutation === 'duplicate_slot') input.composition.blocks.push({ ...block })
    if (mutation === 'unknown_evidence') block.evidenceIds = ['not-in-plan']
    if (mutation === 'missing_slot') input.composition.blocks.pop()
    if (mutation === 'new_number') block.text += '提升99%。'
    if (mutation === 'markdown') block.text = `- ${block.text}`
    if (mutation === 'missing_core_result') block.text = '参与团队产品迭代。'
    expect(() => compileWritingArtifact(input)).toThrow(SupportedWritingError)
  })

  test('uses existing P06C contract and budget, with compact selected facts only', () => {
    const input = context()
    const payload = writingPayload(input.writingPlan)
    const compiled = compileV5Prompt({ component: 'P06C', envelope: { payload } })
    expect(compiled.promptVersion).toBe('5.1.0-p06c-supported-writer-r16')
    expect(compiled.maxOutputTokens).toBeLessThanOrEqual(4800)
    expect(compiled.schema.safeParse(input.composition).success).toBe(true)
    expect(payload).not.toHaveProperty('resumeEvidenceBundle')
    expect(payload).not.toHaveProperty('identity')
    expect(compiled.messages[0].content).toContain('稀疏材料解释已知工作的职业含义')
  })
})
