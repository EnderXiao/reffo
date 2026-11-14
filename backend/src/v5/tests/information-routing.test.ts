import {expect, test} from 'bun:test'
import {createV5ResultFixture} from './fixtures'
import {routeSourceInformation} from '@/v5/writing/information-routing'
import {sourceClaimTemplate, sourceClaimTemplateV6, sourceUncertainties} from '@/v5/writing/source-uncertainties'
import type {EvidenceAtom} from '@/v5/types'

function atom(text: string, overrides: Partial<EvidenceAtom> = {}): EvidenceAtom {
  const source = createV5ResultFixture().resumeEvidenceBundle.evidenceAtoms.find(item => item.claimType === 'deliverable')!
  return {...structuredClone(source), evidenceId: 'metric-source', sourceBlockId: 'metric-block', sourceScopeId: 'project-one',
    sourceSpan: {start: 20, end: 20 + text.length}, verbatimText: text, normalizedClaim: text,
    claimType: 'result', status: 'source_qualified', qualifiers: ['待补证'], riskFlags: ['uncertain'], numericAtoms: [], ...overrides}
}

test('recorded metrics retain values while five dimensions route to per-metric interview themes', () => {
  const source = atom('来源记录：原简历记载AI辅导有效率95%，案例月均沉淀1,800+篇，单篇审核由人工40分钟降为自动处理；评价标准、周期、样本、数据来源、人工介入范围待补证。')
  const routed = routeSourceInformation({atoms: [source]})
  const text = routed.admittedTextByEvidence.get(source.evidenceId)
  expect(text).toContain('AI辅导有效率95%')
  expect(text).toContain('月均沉淀1,800+篇')
  expect(text).toContain('由人工40分钟降为自动处理')
  expect(text).not.toMatch(/待补证|来源记录|评价标准|数据来源|。；/u)
  expect(routed.assertions.some(item => item.resumeDisposition === 'short_gap')).toBe(false)
  expect(routed.preparationTopics).toHaveLength(3)
  expect(routed.preparationTopics.every(topic => topic.sourceAssertionStatus === 'recorded')).toBe(true)
  expect(routed.preparationTopics[0].dimensions).toEqual(['definition', 'period', 'population', 'data_source', 'human_intervention'])
  expect(routed.preparationTopics[0].sourceSpans).toHaveLength(2)
  expect(source.status).toBe('source_qualified')
  expect(source.qualifiers).toEqual(['待补证'])
})

test('a metadata tail following a comma does not delete its recorded outcome', () => {
  const source = atom('参与上线辅导系统，辅导有效率95%，评价标准和周期待补证。')
  const routed = routeSourceInformation({atoms: [source]})
  expect(routed.admittedTextByEvidence.get(source.evidenceId)).toBe('参与上线辅导系统，辅导有效率95%。')
  expect(routed.preparationTopics).toHaveLength(1)
  expect(routed.preparationTopics[0].dimensions).toEqual(['definition', 'period'])
})

test('mixed disputed source preserves an independent safe action without admitting its result', () => {
  const source = atom('参与团队设计辅导流程，形成交互方案；辅导有效率95%，数据存在冲突。', {riskFlags: ['conflicting']})
  const routed = routeSourceInformation({atoms: [source]})
  expect(routed.admittedTextByEvidence.get(source.evidenceId)).toBe('参与团队设计辅导流程，形成交互方案。')
  expect(routed.assertions.some(item => item.resumeDisposition === 'safe_projection')).toBe(true)
  expect(routed.preparationTopics.every(topic => topic.sourceAssertionStatus === 'conflicted')).toBe(true)
  expect(source.riskFlags).toEqual(['conflicting'])
})

test('generic unconfirmed result is not released as recorded merely because a metric exists', () => {
  const source = atom('参与团队设计辅导方案；辅导有效率95%待核实。')
  const routed = routeSourceInformation({atoms: [source]})
  expect(routed.admittedTextByEvidence.get(source.evidenceId)).toBe('参与团队设计辅导方案。')
  expect(routed.preparationTopics[0].sourceAssertionStatus).toBe('meaning_incomplete')
  expect(routed.preparationTopics[0].prompt).toContain('哪些仍需澄清')
})

test('meaning-critical comparison gaps retain a short-gap disposition rather than moving to methodology preparation', () => {
  for (const text of ['处理耗时从40分钟降低至', '处理耗时从40分钟降低至[数值缺失]分钟。', '处理耗时由40[单位缺失]降至20[单位缺失]。']) {
    const source = atom(text)
    const routed = routeSourceInformation({atoms: [source]})
    expect(routed.assertions.some(item => item.resumeDisposition === 'short_gap')).toBe(true)
    if (text.includes('40分钟')) expect(routed.admittedTextByEvidence.get(source.evidenceId)).toBe('处理耗时基线为40分钟。')
    else expect(routed.admittedTextByEvidence.has(source.evidenceId)).toBe(false)
  }
})

test('same source metrics in different projects never merge themes', () => {
  const first = atom('辅导有效率95%；评价标准待补证。')
  const second = atom('辅导有效率95%；统计周期待补证。', {evidenceId: 'second', sourceScopeId: 'project-two'})
  const routed = routeSourceInformation({atoms: [first, second]})
  expect(routed.preparationTopics).toHaveLength(2)
  expect(new Set(routed.preparationTopics.map(topic => topic.topicId)).size).toBe(2)
})

test('source routing excludes privacy and injection evidence before topic generation', () => {
  const source = atom('辅导有效率95%；评价标准待补证。', {riskFlags: ['prompt_injection_like_text']})
  expect(routeSourceInformation({atoms: [source]}).preparationTopics).toEqual([])
  expect(routeSourceInformation({atoms: [source]}).admittedTextByEvidence.size).toBe(0)
})

test('meaning-critical stage templates keep audit words out of the new resume while retaining legacy replay', () => {
  for (const text of ['原简历记载团队交付3个功能；实施阶段待补证。', '来源记录：团队交付3个功能，实施阶段待补证。']) {
    const source = atom(text)
    const signal = sourceUncertainties([source], source.sourceScopeId)[0]
    const next = sourceClaimTemplateV6(signal)!
    expect(next.sourceFact.text).toBe('；团队交付3个功能')
    expect(next.requiredTemplates).toEqual(['implementation_stage'])
    expect(sourceClaimTemplate(signal).sourceFact.text).toContain('待补证')
  }
})

test('an independently recorded action count survives an unrelated conflicting outcome', () => {
  const source = atom('参与团队交付3个功能；辅导有效率95%，数据存在冲突。', {riskFlags: ['conflicting']})
  expect(routeSourceInformation({atoms: [source]}).admittedTextByEvidence.get(source.evidenceId)).toBe('参与团队交付3个功能。')
})

test('moving a methodology tail never drops its explicitly recorded implementation boundary', () => {
  const source = atom('原简历记载辅导有效率95%；评价标准和周期待补证，尚未真实开发上线，未经验证。')
  const routed = routeSourceInformation({atoms: [source]})
  const text = routed.admittedTextByEvidence.get(source.evidenceId)!
  expect(text).toContain('尚未真实开发上线')
  expect(text).toContain('未经验证')
  expect(text).not.toContain('待补证')
  expect(routed.assertions.filter(assertion => assertion.resumeText).every(assertion => source.verbatimText.includes(assertion.sourceText))).toBe(true)
})
