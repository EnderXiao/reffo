import type {InterviewPreparationTopic, InterviewPresentation, ProcessResult} from '@/types'
import {hasResumeCompletionPlaceholder} from '@/shared/resume-strategy'
import {normalizeRequirementAnalysis} from '@/utils/requirement-analysis'

interface JobReference {requirementId: string; quote: string; focus?: string}
type SourceGroup = InterviewPresentation['stories'][number]['sourceGroups'][number]
const object = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined

/** 仅显式提供的岗位 ID 可以连接原文，行动计划不构成故事与岗位的关联证明。 */
export function resolveInterviewJobReferences(result: ProcessResult, requirementIds: string[], _actionIds: string[], jdContent: string): JobReference[] {
  const ids = new Set(requirementIds)
  const references: JobReference[] = []
  const add = (id: unknown, quote: unknown) => {
    if (typeof id !== 'string' || !ids.has(id) || typeof quote !== 'string' || !quote.trim()
      || !jdContent.includes(quote) || references.some(item => item.requirementId === id && item.quote === quote)) return
    references.push({requirementId: id, quote})
  }
  for (const source of result.matching.jd_structure?.requirement_sources ?? []) add(source.requirement_id, source.source_quote)
  const analysis = normalizeRequirementAnalysis(result.matching.requirement_analysis)
  if (analysis) for (const item of [analysis.portrait, ...analysis.tasks, ...analysis.outcomes, ...analysis.successConditions,
    ...analysis.attributes, ...analysis.externalRequirements, ...analysis.conflicts]) {
    if (item) for (const quote of item.sourceQuotes) add(item.id, quote)
  }
  const structure = object(result.matching.jd_structure)
  const atoms = structure?.requirementAtoms ?? structure?.requirement_atoms
  if (Array.isArray(atoms)) for (const value of atoms) {
    const atom = object(value)
    const id = atom?.requirementId ?? atom?.requirement_id
    const quote = atom?.sourceQuote ?? atom?.source_quote
    if (typeof quote === 'string') add(id, quote)
    else {
      const span = object(atom?.sourceSpan ?? atom?.source_span)
      const start = span?.start ?? span?.startOffset
      const end = span?.end ?? span?.endOffset
      if (typeof start === 'number' && typeof end === 'number' && Number.isInteger(start) && Number.isInteger(end)
        && start >= 0 && end > start && end <= jdContent.length) add(id, jdContent.slice(start, end))
    }
  }
  return references
}

function cleanReference(value: string) {
  return value.replace(/^#{1,6}\s*/, '').replace(/^[-*+]\s+/, '').trim()
}

function legacySourceGroups(references: NonNullable<ProcessResult['interview']['story_recommendations'][number]['source_references']>, title: string): SourceGroup[] {
  const groups = new Map<string, SourceGroup>()
  for (const reference of references) {
    if (!reference.evidence_id || !reference.source_scope_id || !reference.source_quote?.trim()
      || hasResumeCompletionPlaceholder(reference.source_quote)) continue
    const key = `${reference.source_scope_id}:${reference.source_kind}`
    const group = groups.get(key) ?? {sourceKind: reference.source_kind, label: title, evidenceIds: [], spans: [], paragraphs: []}
    if (!group.evidenceIds.includes(reference.evidence_id)) group.evidenceIds.push(reference.evidence_id)
    const text = cleanReference(reference.source_quote)
    if (/^#{1,6}\s/.test(reference.source_quote)) { group.label = text; groups.set(key, group); continue }
    const stage = text.replace(/^[ABC]\s*[|｜]\s*/, '')
    if (/^(?:研究(?:与方向形成)?|规划|设计|开发|验证|未上线)(?:阶段)?$/.test(stage)) {
      if (!group.stage) group.stage = stage
    } else if (text && !group.paragraphs.includes(text)) group.paragraphs.push(text)
    groups.set(key, group)
  }
  return [...groups.values()].filter(group => group.paragraphs.length > 0)
}

export function interviewPresentation(result: ProcessResult) {
  const presentation = result.interview?.presentation
  const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string')
  if (presentation?.version !== 'interview-presentation-v1' || !Array.isArray(presentation.questions) || !Array.isArray(presentation.stories)) return undefined
  const validQuestions = presentation.questions.every(item => item && typeof item.questionId === 'string' && typeof item.question === 'string'
    && typeof item.preparationFocus === 'string' && strings(item.sourceEvidenceIds) && strings(item.requirementIds) && Array.isArray(item.topics))
  const validStories = presentation.stories.every(item => item && typeof item.storyId === 'string' && typeof item.title === 'string'
    && typeof item.scopeId === 'string' && Array.isArray(item.topics) && Array.isArray(item.sourceGroups) && item.sourceGroups.every(group => group
      && ['source_resume', 'user_fact'].includes(group.sourceKind) && typeof group.label === 'string' && strings(group.evidenceIds) && strings(group.paragraphs))
    && Array.isArray(item.jobReferences) && item.jobReferences.every(reference => reference && typeof reference.requirementId === 'string' && typeof reference.quote === 'string'))
  return validQuestions && validStories ? presentation : undefined
}

/** 只升级同一份面试的展示数据，不替换用户当前稿或已重新生成的面试。 */
export function upgradeInterviewPresentation(local: ProcessResult, authoritative: ProcessResult): ProcessResult {
  const remote = interviewPresentation(authoritative)
  if (!remote || interviewPresentation(local)) return local
  const content = (result: ProcessResult) => ({
    questions: result.interview.questions,
    followUps: result.interview.follow_up_questions,
    stories: result.interview.story_recommendations.map(story => ({title: story.title, background: story.background, result: story.result,
      approach: story.storytelling_approach, references: story.source_references ?? []})),
    basedOn: result.interview.based_on_document ?? interviewPresentation(result)?.basedOnDocument ?? null,
  })
  if (JSON.stringify(content(local)) !== JSON.stringify(content(authoritative))) return local
  return {...local, interview: {...local.interview, presentation: remote, story_recommendations: local.interview.story_recommendations.map((story, index) => {
    const reference = authoritative.interview.story_recommendations[index]
    return {...story, ...(reference.story_id ? {story_id: reference.story_id} : {}),
      ...(reference.scope_id ? {scope_id: reference.scope_id} : {}), ...(reference.case_group_id ? {case_group_id: reference.case_group_id} : {})}
  })}}
}

export function interviewSourceHeading(group: SourceGroup, storyTitle: string) {
  const normalize = (value: string) => cleanReference(value).replace(/[\s\p{P}]/gu, '')
  const label = group.label?.trim() || ''
  const stage = group.stage?.trim() || ''
  const labelKey = normalize(label)
  const titleKey = normalize(storyTitle)
  const stageKey = normalize(stage)
  const showLabel = labelKey && !titleKey.includes(labelKey) && labelKey !== stageKey
  return [group.sourceKind === 'user_fact' ? '用户补充（尚未经独立核验）' : '源简历依据',
    showLabel ? label : '', stageKey && !(showLabel && labelKey.includes(stageKey)) ? stage : ''].filter(Boolean).join(' · ')
}

export function buildInterviewStoryViewItems(result: ProcessResult, _resumeContent: string, _jdContent: string) {
  const presentation = interviewPresentation(result)
  const stories = result.interview?.story_recommendations ?? []
  return stories.map(story => {
    const title = story.title || '未命名故事'
    const matching = presentation?.stories.filter(item => story.story_id ? item.storyId === story.story_id : item.title === title) ?? []
    const projected = matching.length === 1 ? matching[0] : undefined
    const sourceReferences = story.source_references?.filter(reference => reference.evidence_id && reference.source_scope_id && reference.source_quote?.trim()) ?? []
    return {
      title, background: story.background || '', result: projected?.resultText ?? story.result ?? '',
      storytellingApproach: Array.isArray(story.storytelling_approach)
        ? story.storytelling_approach.filter(point => typeof point === 'string' && point.trim()).map(point => point.trim()) : [],
      sourceReferences,
      sourceGroups: presentation ? projected?.sourceGroups ?? [] : legacySourceGroups(sourceReferences, title),
      // 历史 related_requirement_ids 曾由证据交集反推，不能当作显式岗位关联。
      jdReferences: projected?.jobReferences ?? [],
      presentation: projected,
    }
  })
}

export function interviewNeedsRefresh(result: ProcessResult): boolean {
  const document = result.optimized.completion_document
  const reference = result.interview.based_on_document ?? interviewPresentation(result)?.basedOnDocument
  if (!document) return false
  if (!reference) return document.revision > 0
  return reference.documentId !== document.documentId || reference.revision !== document.revision
    || reference.resolvedDigest !== result.optimized.resolved_action_plan?.resolvedDigest
}

/** 服务端投影决定唯一落点；旧主题必须有唯一的直接证据归属。 */
export function buildInterviewPreparationView(result: ProcessResult, stories: ReturnType<typeof buildInterviewStoryViewItems>) {
  const presentation = interviewPresentation(result)
  const seen = new Set<string>()
  const unique = (topics: InterviewPreparationTopic[]) => topics.filter(topic => topic.topicId && topic.prompt?.trim()
    && !seen.has(topic.topicId) && Boolean(seen.add(topic.topicId)))
  const questionTopics = presentation?.questions.map(item => unique(item.topics)) ?? []
  const storyTopics: InterviewPreparationTopic[][] = stories.map(story => unique(story.presentation?.topics ?? []))
  if (!presentation) {
    for (const topic of unique(result.interview?.preparation_topics ?? [])) {
      const targets = stories.map((story, index) => ({story, index})).filter(({story}) => story.sourceReferences.some(reference =>
        reference.source_scope_id === topic.scopeId && topic.sourceEvidenceIds.includes(reference.evidence_id)))
      if (targets.length === 1 && topic.preparationFocus?.trim()) storyTopics[targets[0].index].push(topic)
    }
  }
  return {storyTopics, questionTopics}
}
