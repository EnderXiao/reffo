import {expect, test} from 'bun:test'
import {createV5ResultFixture} from './fixtures'
import {createTargetingFixture} from './targeting-fixtures'
import {buildWritingPlan} from '@/v5/writing/plan'
import {buildEntryWritingPlan, compileEntryWriting, entryWritingOutputSchema, normalizeEntryWritingOutput, type EntryBrief, type WrittenEntry} from '@/v5/writing/entries'
import {safeRecoveredEntry} from '@/v5/writing/detail-ledger'
import {writeValidatedEntries} from '@/v5/writing/entry-correction'
import {SupportedWritingError} from '@/v5/writing/compiler'
import {writingIssue} from '@/v5/writing/facts'
import {recoverSkillParagraphs} from '@/v5/writing/skill-recovery'
import {sanitizeWritingRecoveryDiagnostics} from '@/v5/writing/recovery-diagnostics'

function fixture() {
  const result = createV5ResultFixture(), targeting = createTargetingFixture()
  const source = result.resumeEvidenceBundle.evidenceAtoms.find(atom => atom.claimType === 'deliverable')!
  source.verbatimText = '参与团队设计门店辅导系统，通过用户访谈梳理岗位使用流程并形成需求文档，交付页面原型和交互流程供方案讨论。'
  source.normalizedClaim = source.verbatimText; source.numericAtoms = []
  const input = {resume: result.resumeEvidenceBundle, plan: result.resumePlan, policy: result.generationPolicy,
    job: result.jobRequirementBundle, match: result.matchAnalysis,
    targeting: {profile: targeting.candidate.jobSuccessProfile, targets: targeting.targets, fit: targeting.fit},
    editorialPolicy: 'document-editorial-v1' as const}
  const plan = buildEntryWritingPlan({...input, base: buildWritingPlan(input)})
  const business = plan.entries.find(entry => entry.slot.kind === 'business_bullet')!
  const output = {contractVersion: 'entry-writing-v1' as const, entries: plan.entries.map(entry => {
    const fact = entry.facts.find(item => entry.coreEvidenceIds.includes(item.evidenceId)) ?? entry.facts[0]
    return {entryId: entry.entryId, paragraphs: [{unitId: `${entry.entryId}:source`, role: 'detail' as const,
      text: fact.text, evidenceIds: [fact.evidenceId]}]}
  })}
  const skill: EntryBrief = {...structuredClone(business), entryId: 'entry:90', section: 'skills', scopeId: null,
    slot: {...business.slot, slotId: 'skill-recovery', kind: 'skill', sectionKey: 'skills', scopeId: null, outputPath: 'skills[9]'},
    detailSeeds: [], sourceUncertainties: [], strategyActions: [], taskIds: []}
  return {input, plan, business, output, skill, source}
}

test('practice-only skill recovery passes the real whole-document gates after bounded corrections', async () => {
  const f = fixture()
  expect(f.skill.facts.every(fact => fact.claimType !== 'skill')).toBe(true)
  f.plan.entries.push(f.skill)
  f.output.entries.push({entryId: f.skill.entryId, paragraphs: [{unitId: 'copied-event', role: 'detail',
    text: f.source.verbatimText, evidenceIds: [f.source.evidenceId]}]})
  let calls = 0
  const recovered = await writeValidatedEntries({plan: f.plan,
    write: async payload => {calls++; return {...f.output, entries: f.output.entries.filter(entry => payload.requiredEntryIds.includes(entry.entryId))}},
    recoverEntry: safeRecoveredEntry,
    validate: output => compileEntryWriting({output, entryPlan: f.plan, resume: f.input.resume, policy: f.input.policy})})
  expect(calls).toBe(3)
  expect(recovered.recoveredEntryIds).toEqual([f.skill.entryId])
  expect(recovered.result.artifact.markdown).toContain('参与实践：用户访谈、需求文档、原型')
  expect(recovered.result.artifact.markdown.match(/参与团队设计门店辅导系统/gu)).toHaveLength(1)
})

test('skill recovery merges only covered source clauses and retains an independent ability', () => {
  const f = fixture(), source = f.skill.facts[0]
  const skill = {...source, claimType: 'skill' as const, evidenceId: 'declared-skill', text: '熟悉SQL；使用Figma制作原型。'}
  const written = {entryId: f.skill.entryId, paragraphs: [{role: 'detail' as const, text: skill.text, evidenceIds: [skill.evidenceId]}]}
  const paragraphs = recoverSkillParagraphs({...f.skill, facts: [skill]}, [skill], {written,
    renderedSkills: [{text: '熟悉SQL。', evidenceIds: [skill.evidenceId]}]})
  expect(paragraphs.map(item => item.text)).toEqual(['使用Figma制作原型。'])
  expect(paragraphs[0].evidenceIds).toEqual([skill.evidenceId])
})

test('formatting equivalence does not conflate C++ with C when retaining unique source skills', () => {
  const f = fixture(), skill = {...f.skill.facts[0], claimType: 'skill' as const, text: 'C++'}
  const paragraphs = recoverSkillParagraphs({...f.skill, facts: [skill]}, [skill], {written: f.output.entries[0],
    renderedSkills: [{text: 'C。', evidenceIds: ['other-skill']}]})
  expect(paragraphs[0].text).toBe('C++。')
})

test('an unfamiliar independently cited method survives recovery alongside a repeated case', () => {
  const f = fixture(), fact = {...f.skill.facts[0], claimType: 'action' as const, boundaries: [],
    text: '运用卡片分类法与用户访谈形成信息架构方案。'}
  const paragraphs = recoverSkillParagraphs({...f.skill, facts: [fact]}, [fact], {written: {entryId: f.skill.entryId, paragraphs: [
    {role: 'detail', text: '卡片分类法与用户访谈；运用卡片分类法与用户访谈形成信息架构方案。', evidenceIds: [fact.evidenceId]},
  ]}})
  expect(paragraphs[0].text).toBe('卡片分类法与用户访谈。')
  expect(paragraphs[0].evidenceIds).toEqual([fact.evidenceId])
})

test('an untraceable independent method blocks instead of delivering only a recognized dictionary subset', () => {
  const f = fixture(), fact = {...f.skill.facts[0], claimType: 'action' as const, boundaries: [], text: '运用卡片分类法与用户访谈形成信息架构方案。'}
  expect(() => recoverSkillParagraphs({...f.skill, facts: [fact]}, [fact], {written: {entryId: f.skill.entryId, paragraphs: [
    {role: 'detail', text: '信息架构研究与用户访谈；运用卡片分类法与用户访谈形成信息架构方案。', evidenceIds: [fact.evidenceId]},
  ]}})).toThrow(SupportedWritingError)
})

test('discarding a complete event requires literal same-source coverage in the retained document', () => {
  const f = fixture(), fact = {...f.skill.facts[0], claimType: 'action' as const, boundaries: [],
    text: '运用卡片分类法与用户访谈形成信息架构方案。'}
  const brief = {...f.skill, facts: [fact]}
  const written: WrittenEntry = {entryId: brief.entryId, paragraphs: [{role: 'detail', text: fact.text, evidenceIds: [fact.evidenceId]}]}
  const retained: WrittenEntry = {entryId: f.business.entryId, paragraphs: [{role: 'detail',
    text: '运用 卡片分类法与用户访谈，形成信息架构方案。', evidenceIds: [fact.evidenceId]}]}
  const recovered = recoverSkillParagraphs(brief, [fact], {written, otherEntries: [retained]})
  expect(recovered[0].text).toBe('参与实践：用户访谈。')
  for (const otherEntries of [[], [{...retained, paragraphs: [{...retained.paragraphs[0], text: '用户访谈。'}]}],
    [{...retained, paragraphs: [{...retained.paragraphs[0], evidenceIds: ['foreign-source']}]}]]) {
    expect(() => recoverSkillParagraphs(brief, [fact], {written, otherEntries})).toThrow(SupportedWritingError)
  }
})

test('recorded repeated-case paraphrase recovers only when its complete admitted source survives with the same citation', () => {
  // Minimal anonymized shape of fresh-4: one action source, one paraphrased
  // repeated-case skill, and a business paragraph retaining the whole source.
  const f = fixture(), fact = {...f.skill.facts[0], claimType: 'action' as const, boundaries: [],
    text: '持续6个月开展竞品分析，围绕安装条件、维护成本与操作路径整理品类对比报告，形成方案讨论材料。'}
  const brief = {...f.skill, facts: [fact]}
  const written: WrittenEntry = {entryId: brief.entryId, paragraphs: [{role: 'detail',
    text: '竞品分析：以安装条件、维护成本与操作路径为跟踪维度，连续6个月输出品类对比材料，供方案讨论。', evidenceIds: [fact.evidenceId]}]}
  const retained: WrittenEntry = {entryId: f.business.entryId, paragraphs: [{role: 'detail', text: fact.text, evidenceIds: [fact.evidenceId]}]}
  expect(recoverSkillParagraphs(brief, [fact], {written, otherEntries: [retained]})[0].text).toBe('参与实践：竞品分析。')
  for (const body of [
    {...retained, paragraphs: [{...retained.paragraphs[0], text: '持续6个月开展竞品分析，形成方案讨论材料。'}]},
    {...retained, paragraphs: [{...retained.paragraphs[0], evidenceIds: ['foreign-source']}]},
  ]) expect(() => recoverSkillParagraphs(brief, [fact], {written, otherEntries: [body]})).toThrow(SupportedWritingError)
})

test('unrecognized or qualified practice is blocked instead of copying a case or inventing an ability', () => {
  const f = fixture()
  for (const text of ['参与团队完成一项没有记录具体方法的工作。', '计划使用Figma开展原型设计。', '未使用SQL完成数据分析。']) {
    const fact = {...f.skill.facts[0], text, claimType: 'action' as const}
    expect(() => recoverSkillParagraphs({...f.skill, facts: [fact]}, [fact], {written: f.output.entries[0]}))
      .toThrow(SupportedWritingError)
  }
})

test('terminal error and successful earlier recovery survive a later unchanged skill failure', async () => {
  const f = fixture(), first = f.business
  f.plan.entries.push(f.skill)
  f.output.entries.push({entryId: f.skill.entryId, paragraphs: [{unitId: 'skill', role: 'detail', text: f.source.verbatimText, evidenceIds: [f.source.evidenceId]}]})
  let calls = 0, recoveries = 0
  try {
    await writeValidatedEntries({plan: f.plan,
      write: async payload => {calls++; return {...f.output, entries: f.output.entries.filter(entry => payload.requiredEntryIds.includes(entry.entryId))}},
      recoverEntry: (entry, rejected) => {
        recoveries++
        return entry.entryId === first.entryId ? {...rejected!.written, paragraphs: [{role: 'detail', text: '已安全恢复', evidenceIds: [f.source.evidenceId]}]}
          : rejected!.written
      },
      validate: output => {
        const parsed = entryWritingOutputSchema.parse(output)
        if (parsed.entries.find(entry => entry.entryId === first.entryId)!.paragraphs[0].text !== '已安全恢复') {
          throw new SupportedWritingError([writingIssue('WRITER_GAP_BOUNDARY_INVALID', first.slot.outputPath, [], '留白边界')])
        }
        throw new SupportedWritingError([writingIssue('WRITER_SKILL_CASE_REPEATED', f.skill.slot.outputPath, [], '技能重复')])
      }})
    throw new Error('expected failure')
  } catch (error) {
    expect(error).toBeInstanceOf(SupportedWritingError)
    const failure = error as SupportedWritingError
    expect(failure.issues.map(issue => issue.code)).toEqual(['WRITER_SKILL_CASE_REPEATED'])
    expect(failure.recoveryDiagnostics?.initialIssueCodes).toEqual(['WRITER_GAP_BOUNDARY_INVALID'])
    expect(failure.recoveryDiagnostics?.finalIssueCodes).toEqual(['WRITER_SKILL_CASE_REPEATED'])
    expect(failure.recoveryDiagnostics?.recoveredEntryIds).toEqual([first.entryId])
    expect(failure.recoveryDiagnostics?.decisions).toContainEqual(expect.objectContaining({entryId: f.skill.entryId, outcome: 'unchanged'}))
  }
  expect(calls).toBe(3)
  expect(recoveries).toBe(2)
})

test('an unaffected paragraph keeps its blank, detail decision and action receipt during scoped correction', async () => {
  const f = fixture(), id = f.source.evidenceId, entryId = f.business.entryId
  const detail = {detailId: 'finding', element: 'result' as const, detailKind: 'research_finding' as const, subject: '门店访谈',
    anchorEvidenceIds: [id], targetTaskIds: [], sourceState: 'missing' as const, answerEvidenceIds: [],
    expressionState: 'underspecified' as const, decision: 'supplement' as const, reason: '未记录具体发现', benefit: '体现研究判断'}
  const receipt = {actionId: 'keep-research', unitIds: ['kept'], evidenceIds: [id], detailIds: ['finding'], coveredAspectIds: [], explanation: '保留研究发现填写格'}
  const written: WrittenEntry = {entryId, detailAssessments: [detail], actionReceipts: [receipt], paragraphs: [
    {unitId: 'kept', role: 'detail', text: f.source.verbatimText, evidenceIds: [id], segments: [
      {kind: 'fact', text: f.source.verbatimText.slice(0, -1), evidenceIds: [id]},
      {kind: 'optional_gap_clause', template: 'research_finding', detailId: 'finding', candidates: []},
      {kind: 'fact', text: '。', evidenceIds: [id]}]},
    {unitId: 'bad', role: 'detail', text: '错误数字999', evidenceIds: [id]},
  ]}
  const output = {...f.output, entries: f.output.entries.map(entry => entry.entryId === entryId ? written : entry)}
  const result = await writeValidatedEntries({plan: f.plan,
    write: async (payload, attempt) => {
      if (!attempt) return output
      expect(payload.correction?.issues[0].paragraphIndices).toEqual([1])
      expect(payload.correction?.issues[0].preserveParagraphIndices).toEqual([0])
      return {...output, entries: [{...written, detailAssessments: [], actionReceipts: [], paragraphs: [
        {...written.paragraphs[0], text: '不应改写的段落', segments: [{kind: 'fact', text: '不应改写的段落', evidenceIds: [id]}]},
        {...written.paragraphs[1], text: '安全来源内容'},
      ]}]}
    },
    validate: value => {
      const parsed = entryWritingOutputSchema.parse(value), target = parsed.entries.find(entry => entry.entryId === entryId)!
      if (target.paragraphs[1].text !== '安全来源内容') throw new SupportedWritingError([
        {...writingIssue('WRITER_NUMBER_CHANGED', f.business.slot.outputPath, [], '数字不存在'), paragraphIndex: 1}],
        new Map([[f.business.slot.outputPath, [0]]]))
      return target
    }})
  expect(result.result.paragraphs[0]).toEqual(written.paragraphs[0])
  expect(result.result.detailAssessments).toEqual([detail])
  expect(result.result.actionReceipts).toEqual([receipt])
})

test('reliable compiler paragraph mapping recovers only that source paragraph and preserves other blanks', () => {
  const f = fixture(), id = f.source.evidenceId
  const safe: WrittenEntry['paragraphs'][number] = {unitId: 'safe', role: 'detail', text: f.source.verbatimText, evidenceIds: [id], segments: [
    {kind: 'fact', text: f.source.verbatimText.slice(0, -1), evidenceIds: [id]},
    {kind: 'optional_gap_clause', template: 'research_finding', detailId: 'finding', candidates: []},
    {kind: 'fact', text: '。', evidenceIds: [id]}]}
  const written = {...f.output.entries[0], entryId: f.business.entryId, paragraphs: [safe,
    {unitId: 'bad', role: 'detail' as const, text: '多出999个用户', evidenceIds: [id]}]}
  const recovered = safeRecoveredEntry(f.business, {written,
    issues: [writingIssue('WRITER_NUMBER_CHANGED', f.business.slot.outputPath, [], '数字不存在')], sourceParagraphIndices: [1]})
  expect(recovered.paragraphs[0]).toEqual(safe)
  expect(recovered.paragraphs[1].text).toBe(f.source.verbatimText)
  expect(recovered.paragraphs.some(paragraph => paragraph.text.includes('999'))).toBe(false)
})

test('correcting a number cannot erase an otherwise valid blank in the same paragraph', async () => {
  const f = fixture(), entryId = f.business.entryId, id = f.source.evidenceId
  const detail = {detailId: 'finding', element: 'result' as const, detailKind: 'research_finding' as const, subject: '门店访谈',
    anchorEvidenceIds: [id], targetTaskIds: [], sourceState: 'missing' as const, answerEvidenceIds: [], expressionState: 'underspecified' as const,
    decision: 'supplement' as const, reason: '未记录具体发现', benefit: '体现研究判断'}
  const written: WrittenEntry = {entryId, detailAssessments: [detail], paragraphs: [{unitId: 'same-unit', role: 'detail',
    text: '参与访谈999次。', evidenceIds: [id], segments: [
      {kind: 'fact', text: '参与访谈999次', evidenceIds: [id]},
      {kind: 'optional_gap_clause', template: 'research_finding', detailId: 'finding', candidates: []},
      {kind: 'fact', text: '。', evidenceIds: [id]}]}]}
  const output = {...f.output, entries: f.output.entries.map(entry => entry.entryId === entryId ? written : entry)}
  let calls = 0
  const result = await writeValidatedEntries({plan: f.plan,
    write: async (_, attempt) => {calls++; return attempt ? {...output, entries: [{...written, detailAssessments: [{...detail, decision: 'omit'}],
      paragraphs: [{unitId: 'same-unit', role: 'detail', text: '参与访谈。', evidenceIds: [id], segments: [
        {kind: 'fact', text: '参与访谈', evidenceIds: [id]}, {kind: 'fact', text: '。', evidenceIds: [id]},
      ]}]}]} : output},
    validate: value => {
      const parsed = entryWritingOutputSchema.parse(value), target = parsed.entries.find(entry => entry.entryId === entryId)!
      if (target.paragraphs[0].text.includes('999')) throw new SupportedWritingError([
        {...writingIssue('WRITER_NUMBER_CHANGED', f.business.slot.outputPath, [], '数字不存在'), paragraphIndex: 0}])
      return target
    }})
  expect(calls).toBe(2)
  expect(result.result.paragraphs[0].segments).toContainEqual(written.paragraphs[0].segments![1])
  expect(result.result.detailAssessments).toEqual([detail])
})

test('persisted recovery diagnostics reject arbitrary content and retain only server categories and locations', () => {
  const result = sanitizeWritingRecoveryDiagnostics({initialIssueCodes: ['WRITER_DETAIL_INVALID', 'private resume text'],
    finalIssueCodes: ['WRITER_SKILL_CASE_REPEATED'], recoveredEntryIds: ['entry:0', 'private resume text'], decisions: [
      {attempt: 2, entryId: 'entry:0', disposition: 'local_recovery', outcome: 'validated', issueCodes: [], candidateDigest: 'a'.repeat(64),
        paragraphIndices: [0, -1, 'private resume text'], rawResume: 'must disappear'},
      {attempt: 2, entryId: 'private resume text', disposition: 'blocked', issueCodes: []},
    ]})
  expect(result?.recoveredEntryIds).toEqual(['entry:0'])
  expect(result?.decisions).toHaveLength(1)
  expect(result?.decisions[0].paragraphIndices).toEqual([0])
  expect(JSON.stringify(result)).not.toContain('private resume text')
  expect(JSON.stringify(result)).not.toContain('rawResume')
})

test('only explicitly empty action receipt notes are normalized before strict acceptance', () => {
  const f = fixture()
  for (const note of [null, '']) {
    const output = {...f.output, entries: f.output.entries.map(entry => ({...entry, actionReceiptsNote: note}))}
    const before = structuredClone(output), normalized = normalizeEntryWritingOutput(output)
    expect(normalized.removedNotes).toBe(output.entries.length)
    expect(entryWritingOutputSchema.safeParse(normalized.value).success).toBe(true)
    expect(output).toEqual(before)
  }
  for (const extra of [{actionReceiptsNote: '不可丢弃的说明'}, {actionReceiptsNote: []}, {actionReceiptsNote: null, arbitraryNote: null}]) {
    const output = {...f.output, entries: f.output.entries.map(entry => ({...entry, ...extra}))}
    expect(entryWritingOutputSchema.safeParse(normalizeEntryWritingOutput(output).value).success).toBe(false)
  }
})

test('the server ancillary slot owns non-applicable coverage while body and business coverage gates stay strict', () => {
  const f = fixture(), skill = f.skill
  f.plan.entries.push(skill)
  const target = {entryId: skill.entryId, paragraphs: [{unitId: 'skill-method', role: 'detail' as const,
    text: '参与实践：用户访谈。', evidenceIds: [skill.facts[0].evidenceId]}]}
  f.output.entries.push(target)
  const metadata = ['responsibility', 'project', 'problem', 'solution', 'result'].map(element => ({
    element: element as 'responsibility' | 'project' | 'problem' | 'solution' | 'result',
    status: 'not_applicable' as const, evidenceIds: [skill.facts[0].evidenceId], answer: '辅助条目', resultKind: 'not_applicable' as const,
  }))
  const output = {...f.output, entries: f.output.entries.map(entry => ({...entry, ...(entry.entryId === target.entryId ? {coverage: metadata} : {})}))}
  const before = structuredClone(output)
  const result = compileEntryWriting({output, entryPlan: f.plan, resume: f.input.resume, policy: f.input.policy})
  expect(result.entryAudits.find(entry => entry.entryId === skill.entryId)?.coverage.every(item => item.status === 'not_applicable' && !item.evidenceIds.length)).toBe(true)
  expect(output).toEqual(before)
  const badBody = structuredClone(output)
  badBody.entries.find(entry => entry.entryId === skill.entryId)!.paragraphs[0].text += '新增999个成果。'
  expect(() => compileEntryWriting({output: badBody, entryPlan: f.plan, resume: f.input.resume, policy: f.input.policy})).toThrow(SupportedWritingError)
  const badDetail = structuredClone(output)
  const ancillary = badDetail.entries.find(entry => entry.entryId === skill.entryId)!
  Object.assign(ancillary, {detailAssessments: [{detailId: 'invalid-ancillary-gap', detailKind: 'research_finding', element: 'result',
    subject: '辅助技能', anchorEvidenceIds: ['foreign-source'], targetTaskIds: [], sourceState: 'missing', answerEvidenceIds: [],
    expressionState: 'underspecified', decision: 'supplement', reason: '需要补充', benefit: '表达岗位价值'}]})
  Object.assign(ancillary.paragraphs[0], {segments: [
    {kind: 'fact', text: '参与实践：用户访谈', evidenceIds: [skill.facts[0].evidenceId]},
    {kind: 'optional_gap_clause', template: 'research_finding', detailId: 'invalid-ancillary-gap', candidates: []},
    {kind: 'fact', text: '。', evidenceIds: [skill.facts[0].evidenceId]}]})
  expect(() => compileEntryWriting({output: badDetail, entryPlan: f.plan, resume: f.input.resume, policy: f.input.policy})).toThrow(SupportedWritingError)
  const badBusiness = structuredClone(output)
  badBusiness.entries.find(entry => entry.entryId === f.business.entryId)!.coverage = metadata
  Object.assign(badBusiness.entries.find(entry => entry.entryId === f.business.entryId)!.paragraphs[0], {segments: [
    {kind: 'fact', text: f.source.verbatimText, evidenceIds: [f.source.evidenceId]}]})
  expect(() => compileEntryWriting({output: badBusiness, entryPlan: f.plan, resume: f.input.resume, policy: f.input.policy})).toThrow(SupportedWritingError)
})
