import {deriveInterviewCaseGroups} from '@/v5/interview-source-structure'
import type {ResumeEvidenceBundle} from '@/v5/types'
import type {InterviewPreparationTopic} from '@/v5/writing/information-routing'

/** Remove an editorial prefix, never a substantive clause that merely mentions an evidence grade. */
export function stripInterviewEditorialPrefix(value: string): string {
  let text = value.trim().replace(/^[ABC]\s*[|｜]\s*/iu, '')
  const prefix = /^(?:材料自述等级|证据等级|素材分级|CASE BANK\b|AI归纳(?:说明)?|当前项目[、，,]规划[、，,]AI归纳或待确认的个人贡献)(?:\s*[:：|｜]\s*[^，,；;。]*)?(?:[，,；;。]\s*|$)/iu
  const match = prefix.exec(text)
  if (match) text = text.slice(match[0].length).trim()
  return text
}

/** An employer scope may contain several cases; only explicit evidence membership binds a topic to one. */
export function bindPreparationTopicsToCases(topics: readonly InterviewPreparationTopic[], resume: ResumeEvidenceBundle): InterviewPreparationTopic[] {
  const cases = deriveInterviewCaseGroups(resume)
  return topics.map(topic => {
    const candidates = cases.filter(group => group.sourceScopeId === topic.scopeId
      && topic.sourceEvidenceIds.some(id => group.evidenceIds.includes(id)))
    const group = candidates.length === 1 ? candidates[0] : undefined
    return group ? {...topic, caseGroupId: group.caseGroupId} : {...topic}
  })
}

/** Source editing instructions do not become interview preparation tasks. */
export function isUsefulPreparationTopic(topic: InterviewPreparationTopic, resume: ResumeEvidenceBundle): boolean {
  if (!topic.topicId || !topic.subject.trim() || !topic.prompt.trim() || !topic.preparationFocus.trim()) return false
  const atoms = topic.sourceEvidenceIds.flatMap(id => resume.evidenceAtoms.find(atom => atom.evidenceId === id
    && atom.sourceScopeId === topic.scopeId
    && !atom.riskFlags.some(flag => ['sensitive_pii', 'prompt_injection_like_text'].includes(flag))) ?? [])
  if (!atoms.length) return false
  const onlyStage = /^(?:研究与方向形成阶段|研究阶段|规划阶段|设计阶段|试点阶段|试运行阶段|已上线阶段)[。.]?$/u
  if (!stripInterviewEditorialPrefix(topic.subject) || atoms.every(atom => {
    const text = stripInterviewEditorialPrefix(atom.verbatimText)
    return !text || onlyStage.test(text)
  })) return false
  // An empty dimensions array can still represent a concrete responsibility or delivery boundary.
  return topic.dimensions.length > 0 || /(?:上线|验收|职责|负责|贡献|阶段|边界|结果|指标|数据|调研|访谈|设计|实施|交付|验证)/u.test(topic.sourceStatement)
}

export function filterInterviewPreparationTopics(topics: readonly InterviewPreparationTopic[], resume: ResumeEvidenceBundle): InterviewPreparationTopic[] {
  return bindPreparationTopicsToCases(topics.filter(topic => isUsefulPreparationTopic(topic, resume)), resume)
}
