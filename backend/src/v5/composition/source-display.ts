import type { EvidenceAtom, ResumeEvidenceBundle } from '@/v5/types'

/** A dangling numeric comparison is not a complete result, even with valid quotes. */
export function hasIncompleteMetricValue(value: string) {
  const text = value.trim().replace(/[。.!！?？]+$/u, '').trimEnd()
  return /\d/u.test(text) && /(?:提升至|提高至|增长至|降低至|减少至|下降至|增至|降至|达到|\b(?:to|from))$/iu.test(text)
}

/** Presentation-only edits. Never drop attribution, uncertainty, numbers or negation. */
export function sourceBusinessDisplayText(value: string) {
  return value.trim()
    .replace(/^(?:#{1,6}|[-*+•])\s+/, '')
    .replace(/^(?:关键动作|主要工作|工作内容|主要职责|结果\s*\/\s*边界|项目成果|工作成果)\s*[:：]?\s*/u, '')
    // This is an editing instruction, not a claim about the candidate. The
    // preceding "未真实开发上线" (when present) remains verbatim.
    .replace(/[，,；;]\s*不写商业收益或规模化结果[。.]?$/u, '。')
    .trim()
}

export function hasEditorialSourceText(value: string) {
  return /(?:投递(?:版|前)|需(?:本人)?确认|待(?:本人)?确认|(?:不可|不得|不要)写成|不写商业收益|根据JD|适合用于|适合强调|证据等级|材料自述等级)/iu.test(value)
    || /^(?:[ABC]\s*[|｜丨]|CASE BANK\b)/iu.test(value.trim())
    || /^(?:PRD|材料|原文|研究事实).{0,8}(?:已交叉验证|已确认|已核验)/iu.test(value.trim())
}

export function isBusinessMetadata(atom: EvidenceAtom, resume: ResumeEvidenceBundle, hasSourceAnchoredAction = false) {
  const raw = atom.verbatimText.trim()
  const text = sourceBusinessDisplayText(raw)
  if (/^#{1,6}\s/u.test(raw) || !text) return true
  if (/^(?:硕士毕业论文|博士(?:毕业)?论文)\s*[|｜丨]/u.test(text)) return true
  const compact = (value: string) => value.replace(/[\s。.;；|｜丨]+/gu, '').toLowerCase()
  const scope = resume.timeline.find(item => item.scopeId === atom.sourceScopeId)
  if (scope?.title && compact(scope.title) === compact(text)) return true
  if (!hasSourceAnchoredAction && atom.claimType === 'responsibility' && !/[。；;：:]/u.test(text)
    && !/(?:主导|负责|推动|参与|完成|交付|建立|形成|实现|支持|承担|设计了|管理了)/u.test(text)) return true
  // A role followed by areas of responsibility is metadata, not an action.
  if (/^(?:(?:高级|中级|初级|资深)\s*)?(?:产品经理|产品助理|项目经理|创新策略设计师|设计师|工程师)\s*[；;|｜丨]/u.test(text)) return true
  return /^(?:用户研究|版本管理|产品战略|课程与能力|能力概述|职业概述)\s*[:：、,，]/u.test(text)
    && !/(?:主导|负责|推动|参与|完成|交付|建立|形成|实现)/u.test(text)
}
