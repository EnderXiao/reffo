import {createHash} from 'node:crypto'
import {createDigest} from '@/harness/run-context'
import type {InterviewPresentation, InterviewSuggestions} from '@/types'
import type {EvidenceAtom, InterviewPreparation, InterviewGenerationBasis, ResumeEvidenceBundle} from '@/v5/types'
import {deriveInterviewCaseGroups} from '@/v5/interview-source-structure'
import {hasProvenSourceLayoutSeparator, isSourceLayoutWhitespace} from '@/v5/composition/source-continuation-proof'
import {isLexicallyProvenSourceContinuation} from '@/v5/composition/source-continuation'
import {sourceBusinessDisplayText} from '@/v5/composition/source-display'
import {filterInterviewPreparationTopics, stripInterviewEditorialPrefix} from '@/v5/preparation-topics'
import {interviewUserFactSnapshot} from '@/v5/interview-user-facts'
import {projectInterviewKnownResult} from '@/v5/interview-results'
import type {InterviewPreparationTopic} from '@/v5/writing/information-routing'

export const INTERVIEW_PRESENTATION_VERSION = 'interview-presentation-v1' as const
type Basis = Pick<InterviewGenerationBasis, 'resumeEvidenceBundle' | 'jobRequirementBundle' | 'preparationTopics'>
type Options = {sourceText?: string; basedOnDocument?: InterviewPresentation['basedOnDocument']}
type Story = InterviewPresentation['stories'][number]
const unique = <T>(items: T[]) => [...new Set(items)]
const stable = (prefix: string, value: unknown) => prefix + ':' + createDigest(JSON.stringify(value)).slice(0, 20)
const usable = (atom: EvidenceAtom) => atom.status !== 'excluded' && !atom.riskFlags.some(flag => ['sensitive_pii', 'prompt_injection_like_text'].includes(flag))
const stageLine = /^(?:研究与方向形成阶段|研究阶段|规划阶段|设计阶段|试点阶段|试运行阶段|已上线阶段|尚未上线|未真实开发上线)[。.]?$/u
const stagePrefix = /^(研究与方向形成阶段|研究阶段|规划阶段|设计阶段|试点阶段|试运行阶段|已上线阶段)[，,；;]\s*/u
const object = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string')
function existingItem(suggestions: InterviewSuggestions, field: 'questions' | 'stories', index: number) {
  const presentation = object(suggestions.presentation)
  const items = presentation?.[field]
  return presentation?.version === INTERVIEW_PRESENTATION_VERSION && Array.isArray(items) ? object(items[index]) : undefined
}
function displayParts(value: string) {
  let text = stripInterviewEditorialPrefix(value)
  const match = stagePrefix.exec(text)
  if (match) text = text.slice(match[0].length)
  return {text: sourceBusinessDisplayText(text), stage: match?.[1]}
}

function canonicalSource(basis: Basis, value?: string) {
  if (value === undefined) return undefined
  const text = value.replace(/\r\n?/gu, '\n').normalize('NFC')
  return createHash('sha256').update(text).digest('hex') === basis.resumeEvidenceBundle.sourceDocument.sha256 ? text : undefined
}
function canJoin(previous: EvidenceAtom, current: EvidenceAtom, source?: string) {
  if (previous.sourceDocumentHash !== current.sourceDocumentHash || previous.sourceScopeId !== current.sourceScopeId
    || previous.provenance?.kind === 'user_edit' || current.provenance?.kind === 'user_edit'
    || !isLexicallyProvenSourceContinuation(previous.verbatimText, current.verbatimText)) return false
  const left = /^B(\d+)$/u.exec(previous.sourceBlockId), right = /^B(\d+)$/u.exec(current.sourceBlockId)
  if (!left || !right || Number(right[1]) !== Number(left[1]) + 1) return false
  if (hasProvenSourceLayoutSeparator(previous, current)) return true
  if (!source || source.slice(previous.sourceSpan.start, previous.sourceSpan.end) !== previous.verbatimText
    || source.slice(current.sourceSpan.start, current.sourceSpan.end) !== current.verbatimText) return false
  const separator = source.slice(previous.sourceSpan.end, current.sourceSpan.start)
  return separator === '\n' || isSourceLayoutWhitespace(separator)
}

function sourceGroups(atoms: EvidenceAtom[], resume: ResumeEvidenceBundle, storyTitle: string, source?: string): Story['sourceGroups'] {
  const cases = deriveInterviewCaseGroups(resume)
  const groups = new Map<string, {value: Story['sourceGroups'][number]; atoms: EvidenceAtom[]}>()
  for (const atom of [...atoms].sort((a, b) => a.sourceSpan.start - b.sourceSpan.start || a.evidenceId.localeCompare(b.evidenceId))) {
    const casesForAtom = cases.filter(item => item.evidenceIds.includes(atom.evidenceId))
    const group = casesForAtom.length === 1 ? casesForAtom[0] : undefined
    const kind = atom.provenance?.kind === 'user_edit' ? 'user_fact' : 'source_resume'
    const key = [kind, atom.sourceScopeId, group?.caseGroupId ?? ''].join(':')
    let entry = groups.get(key)
    if (!entry) {
      entry = {value: {sourceKind: kind, label: group && !stageLine.test(group.title) ? group.title : storyTitle, evidenceIds: [], spans: [], paragraphs: []}, atoms: []}
      groups.set(key, entry)
    }
    entry.value.evidenceIds.push(atom.evidenceId)
    entry.value.spans.push({...atom.sourceSpan})
    const raw = atom.verbatimText.trim()
    if (/^#{1,6}\s/u.test(raw)) { if (!group) entry.value.label = sourceBusinessDisplayText(raw); continue }
    if (stageLine.test(raw)) { entry.value.stage = unique([entry.value.stage, raw].filter((value): value is string => Boolean(value))).join('；'); continue }
    const parts = displayParts(raw)
    if (parts.stage && !entry.value.stage) entry.value.stage = parts.stage
    if (stageLine.test(parts.text)) {if (!entry.value.stage) entry.value.stage = parts.text; continue}
    if (group?.titleEvidenceId === atom.evidenceId) continue
    const text = parts.text
    if (!text) continue
    const previous = entry.atoms.at(-1)
    if (previous && entry.value.paragraphs.length && canJoin(previous, atom, source)) {
      entry.value.paragraphs[entry.value.paragraphs.length - 1] += text
    } else if (!entry.value.paragraphs.includes(text)) entry.value.paragraphs.push(text)
    entry.atoms.push(atom)
  }
  return [...groups.values()].map(entry => entry.value).filter(group => group.paragraphs.length > 0 || Boolean(group.stage))
}

function allocateTopics(presentation: InterviewPresentation, basis: Basis) {
  const merged = new Map<string, InterviewPreparationTopic>()
  for (const source of filterInterviewPreparationTopics(basis.preparationTopics ?? [], basis.resumeEvidenceBundle)) {
    const topic = structuredClone(source)
    const identity = topic.caseGroupId ?? [...topic.sourceEvidenceIds].sort().join(',')
    const key = [topic.scopeId, identity, topic.subject.replace(/[\s\p{P}]/gu, '')].join(':')
    const previous = merged.get(key)
    if (!previous) {merged.set(key, topic); continue}
    previous.dimensions = unique([...previous.dimensions, ...topic.dimensions])
    previous.sourceEvidenceIds = unique([...previous.sourceEvidenceIds, ...topic.sourceEvidenceIds])
    previous.requirementIds = unique([...previous.requirementIds, ...topic.requirementIds])
    previous.actionIds = unique([...previous.actionIds, ...topic.actionIds])
    previous.sourceSpans = unique([...previous.sourceSpans, ...topic.sourceSpans].map(span => JSON.stringify(span))).map(span => JSON.parse(span))
    previous.preparationFocus = unique([previous.preparationFocus, topic.preparationFocus]).join(' ')
    previous.sourceStatement = unique([previous.sourceStatement, topic.sourceStatement]).join('；')
    previous.prompt = unique([previous.prompt, topic.prompt]).join(' ')
    if (topic.sourceAssertionStatus === 'conflicted' || previous.sourceAssertionStatus === 'conflicted') previous.sourceAssertionStatus = 'conflicted'
    else if (topic.sourceAssertionStatus === 'meaning_incomplete') previous.sourceAssertionStatus = 'meaning_incomplete'
    previous.userNotes = [...(previous.userNotes ?? []), ...(topic.userNotes ?? [])]
  }
  for (const topic of merged.values()) {
    const candidates: Array<{target: InterviewPreparationTopic[]; score: number}> = []
    for (const story of presentation.stories) {
      if (story.scopeId !== topic.scopeId) continue
      const intersection = story.sourceGroups.some(group => group.evidenceIds.some(id => topic.sourceEvidenceIds.includes(id)))
      if (topic.caseGroupId) {
        if (story.caseGroupId === topic.caseGroupId) candidates.push({target: story.topics, score: intersection ? 4 : 3})
      } else if (intersection) candidates.push({target: story.topics, score: 2})
    }
    for (const question of presentation.questions) if (question.sourceEvidenceIds.some(id => topic.sourceEvidenceIds.includes(id)))
      candidates.push({target: question.topics, score: 1})
    candidates.sort((a, b) => b.score - a.score)
    if (!candidates[0] || candidates[1]?.score === candidates[0].score) continue
    candidates[0].target.push(topic)
  }
}

export function buildInterviewPresentation(preparation: InterviewPreparation, basis: Basis, options: Options = {}): InterviewPresentation {
  const resume = basis.resumeEvidenceBundle
  const cases = deriveInterviewCaseGroups(resume)
  const source = canonicalSource(basis, options.sourceText)
  const presentation: InterviewPresentation = {version: INTERVIEW_PRESENTATION_VERSION,
    ...(options.basedOnDocument ? {basedOnDocument: options.basedOnDocument} : {}),
    questions: preparation.questions.map(item => ({questionId: stable('question', [item.question, item.relatedEvidenceIds, item.relatedRequirementIds]),
      question: item.question, category: item.category, preparationFocus: item.preparationFocus,
      sourceEvidenceIds: item.relatedEvidenceIds.filter(id => resume.evidenceAtoms.some(atom => atom.evidenceId === id && usable(atom))),
      requirementIds: item.relatedRequirementIds.filter(id => basis.jobRequirementBundle.requirementAtoms.some(atom => atom.requirementId === id)), topics: []})),
    stories: preparation.storyRecommendations.map(item => {
      const atoms = unique(item.evidenceIds).flatMap(id => resume.evidenceAtoms.find(atom => atom.evidenceId === id && atom.sourceScopeId === item.scopeId && usable(atom)) ?? [])
      const groups = cases.filter(group => group.sourceScopeId === item.scopeId && atoms.some(atom => group.evidenceIds.includes(atom.evidenceId)))
      const caseGroupId = groups.length === 1 ? groups[0]?.caseGroupId : undefined
      const ids = new Set(atoms.map(atom => atom.evidenceId))
      const jobReferences: Story['jobReferences'] = []
      for (const link of item.requirementLinks ?? []) {
        const requirement = basis.jobRequirementBundle.requirementAtoms.find(atom => atom.requirementId === link.requirementId)
        if (!requirement || !link.evidenceIds.length || !link.evidenceIds.every(id => ids.has(id)) || !link.focus.trim()
          || jobReferences.some(ref => ref.requirementId === link.requirementId)) continue
        jobReferences.push({requirementId: requirement.requirementId, quote: requirement.verbatimText, focus: link.focus, evidenceIds: [...link.evidenceIds]})
      }
      return {storyId: stable('story', [item.scopeId, caseGroupId ?? '', [...ids].sort(), item.title]), title: item.title, scopeId: item.scopeId,
        resultText: item.knownResult === null ? `待核实：${item.preparationGap ?? '结果证据不足'}`
          : projectInterviewKnownResult(item.knownResult, item.evidenceIds, resume.evidenceAtoms, options.sourceText),
        ...(caseGroupId ? {caseGroupId} : {}), sourceGroups: sourceGroups(atoms, resume, item.title, source), jobReferences, topics: []}
    })}
  allocateTopics(presentation, basis)
  const userFactSnapshot = interviewUserFactSnapshot(resume, [...preparation.questions.flatMap(item => item.relatedEvidenceIds), ...preparation.storyRecommendations.flatMap(item => item.evidenceIds)], options.basedOnDocument)
  if (userFactSnapshot) presentation.userFactSnapshot = userFactSnapshot
  return presentation
}

/** Read compatibility is deterministic and never infers a JD link from legacy match/action IDs. */
export function buildLegacyInterviewPresentation(suggestions: InterviewSuggestions, basis?: Basis, options: Options = {}): InterviewPresentation {
  if (basis) {
    const preparation: InterviewPreparation = {schemaVersion: '5.0.0',
      questions: suggestions.questions.map((question, index) => {
        const existing = existingItem(suggestions, 'questions', index)
        const trusted = existing && existing.question === question
          && strings(existing.sourceEvidenceIds) && strings(existing.requirementIds)
          && typeof existing.preparationFocus === 'string'
          && existing.questionId === stable('question', [question, existing.sourceEvidenceIds, existing.requirementIds])
          && existing.sourceEvidenceIds.every(id => basis.resumeEvidenceBundle.evidenceAtoms.some(atom => atom.evidenceId === id && usable(atom)))
          && existing.requirementIds.every(id => basis.jobRequirementBundle.requirementAtoms.some(atom => atom.requirementId === id))
        const category = existing?.category
        return {question, category: trusted && typeof category === 'string' && ['core_task', 'project_deep_dive', 'gap_or_transfer', 'context_scenario'].includes(category)
          ? category as InterviewPreparation['questions'][number]['category'] : 'project_deep_dive' as const,
          relatedRequirementIds: trusted && strings(existing.requirementIds) ? [...existing.requirementIds] : [], relatedEvidenceIds: trusted && strings(existing.sourceEvidenceIds) ? [...existing.sourceEvidenceIds] : [],
          preparationFocus: trusted && typeof existing.preparationFocus === 'string' ? existing.preparationFocus : '', assumptionContextIds: []}
      }),
      storyRecommendations: suggestions.story_recommendations.map((story, index) => {
        const atoms = (story.source_references ?? []).flatMap(ref => basis.resumeEvidenceBundle.evidenceAtoms.find(atom =>
          atom.evidenceId === ref.evidence_id && atom.sourceScopeId === ref.source_scope_id && atom.verbatimText === ref.source_quote && usable(atom)) ?? [])
        const scopes = unique(atoms.map(atom => atom.sourceScopeId))
        const existing = existingItem(suggestions, 'stories', index)
        const ids = new Set(atoms.map(atom => atom.evidenceId))
        const cases = deriveInterviewCaseGroups(basis.resumeEvidenceBundle).filter(group => scopes.length === 1
          && group.sourceScopeId === scopes[0] && atoms.some(atom => group.evidenceIds.includes(atom.evidenceId)))
        const expectedId = stable('story', [scopes.length === 1 ? scopes[0] : '', cases.length === 1 ? cases[0]!.caseGroupId : '', [...ids].sort(), story.title])
        const trustedExisting = existing && existing.title === story.title && scopes.length === 1 && existing.scopeId === scopes[0]
          && existing.storyId === expectedId
          && Array.isArray(existing.sourceGroups) && existing.sourceGroups.every(value => {
            const group = object(value)
            return group && strings(group.evidenceIds) && group.evidenceIds.every(id => ids.has(id))
          })
        const requirementLinks = trustedExisting && Array.isArray(existing.jobReferences) ? existing.jobReferences.flatMap(value => {
          const ref = object(value)
          if (!ref || typeof ref.requirementId !== 'string' || typeof ref.quote !== 'string' || typeof ref.focus !== 'string' || !strings(ref.evidenceIds)) return []
          const requirement = basis.jobRequirementBundle.requirementAtoms.find(atom => atom.requirementId === ref.requirementId && atom.verbatimText === ref.quote)
          return requirement && ref.evidenceIds.length && ref.evidenceIds.every(id => ids.has(id)) && ref.focus.trim()
            ? [{requirementId: ref.requirementId, evidenceIds: [...ref.evidenceIds], focus: ref.focus}] : []
        }) : []
        return {title: story.title, scopeId: scopes.length === 1 ? scopes[0]! : '', evidenceIds: scopes.length === 1 ? atoms.map(atom => atom.evidenceId) : [],
          background: story.background, knownResult: story.result, preparationGap: null, storytellingApproach: story.storytelling_approach, requirementLinks}
      }), followUpQuestions: []}
    return buildInterviewPresentation(preparation, basis, options)
  }
  return {version: INTERVIEW_PRESENTATION_VERSION, ...(options.basedOnDocument ? {basedOnDocument: options.basedOnDocument} : {}),
    questions: suggestions.questions.map(question => ({questionId: stable('question', question), question, preparationFocus: '', sourceEvidenceIds: [], requirementIds: [], topics: []})),
    stories: suggestions.story_recommendations.map(story => {
      const groups = new Map<string, Story['sourceGroups'][number]>()
      for (const ref of story.source_references ?? []) {
        if (!ref.evidence_id || !ref.source_scope_id || !ref.source_quote.trim()) continue
        const key = [ref.source_scope_id, ref.source_kind].join(':')
        const group = groups.get(key) ?? {sourceKind: ref.source_kind, label: story.title, evidenceIds: [], spans: [], paragraphs: []}
        group.evidenceIds.push(ref.evidence_id)
        const raw = ref.source_quote.trim()
        if (/^#{1,6}\s/u.test(raw)) {group.label = sourceBusinessDisplayText(raw); groups.set(key, group); continue}
        if (stageLine.test(raw)) {group.stage = raw; groups.set(key, group); continue}
        const parts = displayParts(ref.source_quote)
        if (parts.stage && !group.stage) group.stage = parts.stage
        const text = parts.text
        if (stageLine.test(text)) {if (!group.stage) group.stage = text}
        else if (text && !group.paragraphs.includes(text)) group.paragraphs.push(text)
        groups.set(key, group)
      }
      return {storyId: story.story_id ?? stable('story', [story.title, [...groups.keys()]]), title: story.title, scopeId: story.scope_id ?? '',
        sourceGroups: [...groups.values()].filter(group => group.paragraphs.length), jobReferences: [], topics: []}
    })}
}
