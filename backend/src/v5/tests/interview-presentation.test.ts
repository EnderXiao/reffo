import {describe, expect, test} from 'bun:test'
import {createHash} from 'node:crypto'
import {buildInterviewPresentation, buildLegacyInterviewPresentation} from '@/v5/interview-presentation'
import {createV5ResultFixture} from '@/v5/tests/fixtures'
import type {EvidenceAtom, InterviewPreparation} from '@/v5/types'
import type {InterviewPreparationTopic} from '@/v5/writing/information-routing'
import type {InterviewSuggestions} from '@/types'

function fixture() {
  const basis = createV5ResultFixture()
  const texts = ['## 员工助手研究', '研究与方向形成阶段', 'C | 研究阶段', '问题 一线操作分散。', '关键动作 主导问卷、10+', '家门店调研、访谈和埋点；尚未上线。']
  const source = texts.join('\n')
  const template = basis.resumeEvidenceBundle.evidenceAtoms[0]!
  let offset = 0
  const hash = createHash('sha256').update(source).digest('hex')
  const atoms: EvidenceAtom[] = texts.map((text, index) => {
    const atom = {...template, evidenceId: 'ev-' + index, sourceScopeId: 'scope', sourceBlockId: 'B' + String(index + 1).padStart(4, '0'),
      sourceDocumentHash: hash, sourceSpan: {start: offset, end: offset + text.length}, verbatimText: text, normalizedClaim: text,
      status: 'source_supported' as const, riskFlags: []}
    offset += text.length + 1
    return atom
  })
  basis.resumeEvidenceBundle.evidenceAtoms = atoms
  basis.resumeEvidenceBundle.sourceDocument.sha256 = hash
  const preparation: InterviewPreparation = {schemaVersion: '5.0.0', questions: [{question: '如何确定改进优先级？', category: 'project_deep_dive',
    relatedRequirementIds: [], relatedEvidenceIds: ['ev-4'], preparationFocus: '说明调研与埋点的取舍。', assumptionContextIds: []}],
    storyRecommendations: [{title: '员工助手调研', scopeId: 'scope', evidenceIds: atoms.map(atom => atom.evidenceId), background: '一线调研', knownResult: null,
      preparationGap: '尚未上线', storytellingApproach: [], requirementLinks: []}], followUpQuestions: []}
  return {basis, preparation, atoms, source}
}
function topic(id = 'topic'): InterviewPreparationTopic {
  return {topicId: id, scopeId: 'scope', subject: '调研样本', dimensions: ['population'], sourceEvidenceIds: ['ev-4'], sourceSpans: [], requirementIds: [],
    actionIds: [], sourceAssertionStatus: 'recorded', sourceStatement: '10+家门店调研', prompt: '说明调研样本如何选择。', preparationFocus: '准备门店选择依据。'}
}

describe('interview presentation', () => {
  test('groups real source paragraphs and joins numeric line breaks only after verifying canonical source', () => {
    const {basis, preparation, source} = fixture()
    const presentation = buildInterviewPresentation(preparation, basis, {sourceText: source})
    const group = presentation.stories[0]!.sourceGroups[0]!
    expect(group.label).toBe('员工助手研究')
    expect(group.stage).toContain('研究与方向形成阶段')
    expect(group.paragraphs.join('')).toContain('10+家门店调研')
    expect(group.paragraphs.join('')).toContain('尚未上线')
    expect(group.paragraphs.join('')).not.toContain('C |')
    expect(group.spans).toHaveLength(6)
    const withoutProof = buildInterviewPresentation(preparation, basis, {sourceText: source + 'modified'})
    expect(withoutProof.stories[0]!.sourceGroups[0]!.paragraphs).toContain('主导问卷、10+')
  })
  test('does not merge across scopes, source documents, gaps or user facts', () => {
    const {basis, preparation, source, atoms} = fixture()
    atoms[5]!.sourceSpan.start++
    expect(buildInterviewPresentation(preparation, basis, {sourceText: source}).stories[0]!.sourceGroups[0]!.paragraphs).toContain('主导问卷、10+')
    atoms[5]!.provenance = {kind: 'user_edit', documentId: 'doc', revision: 1}
    const groups = buildInterviewPresentation(preparation, basis, {sourceText: source}).stories[0]!.sourceGroups
    expect(groups.some(group => group.sourceKind === 'user_fact')).toBe(true)
  })
  test('preserves question focus and assigns a concrete topic once, without generic independent cards', () => {
    const {basis, preparation} = fixture()
    basis.preparationTopics = [topic(), {...topic('same'), dimensions: ['period'], preparationFocus: '准备统计周期。'},
      {...topic('editorial'), subject: '当前项目、规划、AI归纳或待确认的个人贡献', sourceStatement: 'AI归纳'}]
    const presentation = buildInterviewPresentation(preparation, basis)
    expect(presentation.questions[0]!.preparationFocus).toBe('说明调研与埋点的取舍。')
    expect(presentation.questions[0]!.topics).toHaveLength(0)
    expect(presentation.stories[0]!.topics).toHaveLength(1)
    expect(presentation.stories[0]!.topics[0]!.dimensions).toEqual(['population', 'period'])
    expect(presentation).not.toHaveProperty('questionGroups')
    expect(basis.preparationTopics[0]!.dimensions).toEqual(['population'])
  })
  test('never picks the first of equally supported stories', () => {
    const {basis, preparation} = fixture()
    basis.preparationTopics = [topic()]
    preparation.storyRecommendations.push({...preparation.storyRecommendations[0]!, title: '同证据另一故事'})
    expect(buildInterviewPresentation(preparation, basis).stories.every(story => !story.topics.length)).toBe(true)
  })
  test('uses only explicit valid requirements and preserves them through historical reads', () => {
    const {basis, preparation} = fixture()
    const requirement = basis.jobRequirementBundle.requirementAtoms[0]!
    preparation.storyRecommendations[0]!.requirementLinks = [{requirementId: requirement.requirementId, evidenceIds: ['ev-4'], focus: '说明基于调研制定产品优先级。'},
      {requirementId: 'unknown', evidenceIds: ['ev-4'], focus: 'invalid'}, {requirementId: requirement.requirementId, evidenceIds: ['other'], focus: 'invalid'}]
    const presentation = buildInterviewPresentation(preparation, basis)
    expect(presentation.stories[0]!.jobReferences).toHaveLength(1)
    const suggestions: InterviewSuggestions = {questions: preparation.questions.map(item => item.question), follow_up_questions: [], presentation,
      story_recommendations: [{title: '员工助手调研', background: '', result: '', storytelling_approach: [], related_requirement_ids: ['other'],
        source_references: basis.resumeEvidenceBundle.evidenceAtoms.map(atom => ({evidence_id: atom.evidenceId, source_scope_id: atom.sourceScopeId,
          source_kind: 'source_resume', source_quote: atom.verbatimText}))}]}
    expect(buildLegacyInterviewPresentation(suggestions, basis).stories[0]!.jobReferences).toHaveLength(1)
    expect(buildLegacyInterviewPresentation(suggestions, basis).questions[0]!.preparationFocus).toBe('说明调研与埋点的取舍。')
    expect(buildLegacyInterviewPresentation(suggestions, basis).questions[0]!.sourceEvidenceIds).toEqual(['ev-4'])
    delete suggestions.presentation
    expect(buildLegacyInterviewPresentation(suggestions, basis).stories[0]!.jobReferences).toEqual([])
    expect(buildLegacyInterviewPresentation(suggestions).stories[0]!.jobReferences).toEqual([])
  })
  test('does not quote a guessed source when a legacy record has no stable references', () => {
    const {basis} = fixture()
    const suggestions: InterviewSuggestions = {questions: ['问题'], follow_up_questions: [], story_recommendations: [{title: '故事', background: '', result: '', storytelling_approach: []}]}
    expect(buildLegacyInterviewPresentation(suggestions, basis).stories[0]!.sourceGroups).toEqual([])
    expect(buildLegacyInterviewPresentation(suggestions).stories[0]!.sourceGroups).toEqual([])
  })
  test('retains excluded source as preparation material without releasing it as a story fact', () => {
    const {basis, preparation, atoms} = fixture()
    atoms[4]!.status = 'excluded'
    basis.preparationTopics = [topic()]
    const presentation = buildInterviewPresentation(preparation, basis)
    expect(presentation.stories[0]!.sourceGroups.flatMap(group => group.evidenceIds)).not.toContain('ev-4')
    expect(presentation.questions[0]!.sourceEvidenceIds).not.toContain('ev-4')
  })
  test('degrades malformed versioned historical presentation items without throwing', () => {
    const {basis, preparation} = fixture()
    const valid = buildInterviewPresentation(preparation, basis)
    const suggestions: InterviewSuggestions = {questions: preparation.questions.map(item => item.question), follow_up_questions: [],
      story_recommendations: [{title: '员工助手调研', background: '', result: '', storytelling_approach: [],
        source_references: basis.resumeEvidenceBundle.evidenceAtoms.map(atom => ({evidence_id: atom.evidenceId, source_scope_id: atom.sourceScopeId,
          source_kind: 'source_resume', source_quote: atom.verbatimText}))}]}
    for (const presentation of [{version: valid.version}, {...valid, questions: [null], stories: [null]},
      {...valid, questions: [{question: preparation.questions[0]!.question}], stories: [{...valid.stories[0], sourceGroups: [null]}]},
      {...valid, stories: [{...valid.stories[0], jobReferences: [null, {requirementId: 'r', evidenceIds: 3}]}]}]) {
      suggestions.presentation = presentation as InterviewSuggestions['presentation']
      expect(() => buildLegacyInterviewPresentation(suggestions, basis)).not.toThrow()
      expect(buildLegacyInterviewPresentation(suggestions, basis).stories[0]!.jobReferences).toEqual([])
    }
  })
  test('keeps same-named metrics from separate ungrouped projects separate', () => {
    const {basis, preparation} = fixture()
    basis.preparationTopics = [topic(), {...topic('other-project'), sourceEvidenceIds: ['ev-5'], sourceStatement: '另一项目调研样本'}]
    preparation.storyRecommendations[0]!.evidenceIds = ['ev-4']
    preparation.storyRecommendations.push({...preparation.storyRecommendations[0]!, title: '另一项目', evidenceIds: ['ev-5']})
    const presentation = buildInterviewPresentation(preparation, basis)
    expect(presentation.stories.map(story => story.topics.length)).toEqual([1, 1])
    expect(presentation.stories[0]!.topics[0]!.sourceStatement).toBe('10+家门店调研')
    expect(presentation.stories[1]!.topics[0]!.sourceStatement).toBe('另一项目调研样本')
  })
  test('merging one source identity preserves conflicting statements and preparation prompts', () => {
    const {basis, preparation} = fixture()
    basis.preparationTopics = [topic(), {...topic('conflict'), sourceAssertionStatus: 'conflicted', sourceStatement: '另版材料记录12家', prompt: '澄清两版样本数差异。'}]
    const merged = buildInterviewPresentation(preparation, basis).stories[0]!.topics[0]!
    expect(merged.sourceAssertionStatus).toBe('conflicted')
    expect(merged.sourceStatement).toContain('10+家门店调研')
    expect(merged.sourceStatement).toContain('另版材料记录12家')
    expect(merged.prompt).toContain('澄清两版样本数差异')
  })
  test('strips only grade prefixes while retaining actions, numbers and negation', () => {
    const {basis, preparation, atoms} = fixture()
    atoms[4]!.verbatimText = 'C | 研究阶段，已形成3份访谈报告，尚未上线'
    atoms[5]!.verbatimText = '设计证据等级规则，覆盖2类材料，尚未推广。'
    const group = buildInterviewPresentation(preparation, basis).stories[0]!.sourceGroups[0]!
    expect(group.paragraphs.join('')).toContain('已形成3份访谈报告，尚未上线')
    expect(group.paragraphs.join('')).toContain('设计证据等级规则，覆盖2类材料，尚未推广')
    expect(group.paragraphs.join('')).not.toContain('C |')
  })
})
