import type { ResumeStructure } from '@/types'

export interface EvaluationIssue {
  severity: 'info' | 'warning' | 'error'
  code: string
  message: string
  path?: string
}

export interface EvaluationResult {
  evaluatorName: string
  evaluatorVersion: string
  passed: boolean
  score: number
  issues: EvaluationIssue[]
}

const PLACEHOLDER_PATTERNS = [/XXX/i, /公司名称/, /职位名称/, /项目名称/, /学校名称/]
const EXCLUDED_EVIDENCE_PATTERN = /需[^，。；）)]{0,10}(?:确认|说明|核验)|待确认|待核验|口径冲突|口径.*(?:不一致|冲突)|不足以证明|因果(?:不足|不明|无法)|PRD记录|受[^，。；）)]{0,20}(?:影响|推动)|不(?:能|可)[^，。；）)]{0,12}归因|不等同于/

function classifySectionTitle(value: string): 'work' | 'project' | 'timeline' | null {
  const title = value.replace(/[*_`]/g, '').replace(/[（(][^）)]*[）)]\s*$/, '').trim()
  if (/^(?:(?:核心|主要)?(?:工作|职业|任职|实习|实践)(?:经历|经验|履历))$/.test(title)) return 'work'
  if (/^(?:(?:核心|代表|精选)?项目(?:经历|经验|成果|案例)?)$/.test(title)) return 'project'
  if (/^(?:其他经历|补充经历)$/.test(title)) return 'timeline'
  return null
}

function includesAny(markdown: string, values: string[]) {
  return values.some((value) => value.trim() && markdown.includes(value.trim()))
}

function normalizeTimelineText(value: string) {
  return value.replace(/\s/g, '').replace(/[—–~～]/g, '-').toLowerCase()
}

function normalizeMetadata(value: string) {
  return value.replace(/^[-*]\s+/, '').replace(/[*_`]/g, '').replace(/[\s|｜·•,，、:：]/g, '').toLowerCase()
}

function sourceMetadataValues(sourceResume: ResumeStructure) {
  return new Set([
    ...sourceResume.experience.flatMap(item => [item.company, item.position, item.time_range]),
    ...(sourceResume.projects || []).flatMap(item => [item.name, item.role, ...item.tech_stack]),
    sourceResume.personal_info.location || '',
  ].map(normalizeMetadata).filter(Boolean))
}

function isBusinessStatement(line: string, metadataValues: Set<string>) {
  const content = line.trim().replace(/^[-*]\s+/, '').trim()
  if (!content || /^#{1,6}\s+/.test(content) || /^[-*_]{3,}$/.test(content)) return false
  if (/^(?:公司|岗位|职位|角色|项目角色|时间|任职时间|地点|技术栈)\s*[:：]/.test(content)) return false
  const datePattern = /^(?:\d{4}(?:[./年-]\d{1,2})?(?:[./月-]\d{1,2})?\s*[-—至~～]\s*)?(?:\d{4}(?:[./年-]\d{1,2})?(?:[./月-]\d{1,2})?|至今|现在|present)$/i
  if (datePattern.test(content)) return false
  const metadataParts = content.split(/[|｜·•,，、/／]/).map(part => part.trim()).filter(Boolean)
  if (metadataParts.length > 1 && metadataParts.every(part => (
    metadataValues.has(normalizeMetadata(part)) || datePattern.test(part)
  ))) return false
  return !metadataValues.has(normalizeMetadata(content))
}

function sourceBusinessEvidenceCount(sourceResume: ResumeStructure) {
  const hasEligibleEvidence = (value: string) => value
    .split(/[；;]/)
    .some(segment => segment.trim() && !EXCLUDED_EVIDENCE_PATTERN.test(segment))
  const experienceCount = sourceResume.experience.reduce(
    (sum, item) => sum
      + item.responsibilities.filter(hasEligibleEvidence).length
      + item.achievements.filter(hasEligibleEvidence).length,
    0
  )
  const projectCount = (sourceResume.projects || []).reduce(
    (sum, item) => sum
      + (item.description.trim() && hasEligibleEvidence(item.description) ? 1 : 0)
      + item.achievements.filter(hasEligibleEvidence).length,
    0
  )
  return experienceCount + projectCount
}

function minimumBusinessEvidenceCount(sourceResume: ResumeStructure) {
  const sourceCount = sourceBusinessEvidenceCount(sourceResume)
  return sourceCount === 0 ? 0 : Math.min(3, Math.max(1, Math.ceil(sourceCount / 2)))
}

function inspectBusinessSections(markdown: string, sourceResume: ResumeStructure) {
  const lines = markdown.split(/\r?\n/)
  const metadataValues = sourceMetadataValues(sourceResume)
  const emptyWorkEntries: string[] = []
  const emptyProjectEntries: string[] = []
  let businessStatementCount = 0

  for (let sectionStart = 0; sectionStart < lines.length;) {
    const sectionHeading = lines[sectionStart].match(/^##\s+(.+)/)
    if (!sectionHeading) {
      sectionStart += 1
      continue
    }

    let sectionEnd = sectionStart + 1
    while (sectionEnd < lines.length && !/^##\s+/.test(lines[sectionEnd])) sectionEnd += 1
    const sectionTitle = sectionHeading[1].trim()
    const sectionKind = classifySectionTitle(sectionTitle)
    if (sectionKind === 'timeline') {
      const timelineLines = lines.slice(sectionStart + 1, sectionEnd).filter(line => line.trim())
      const hasSourceTimelineEntry = sourceResume.experience.some(item => timelineLines.some(line => (
        line.includes(item.company)
        && (line.includes(item.position) || line.includes(item.time_range))
      )))
      if (!hasSourceTimelineEntry) emptyWorkEntries.push(sectionTitle || '其他经历')
      sectionStart = sectionEnd
      continue
    }
    if (sectionKind !== 'work' && sectionKind !== 'project') {
      sectionStart = sectionEnd
      continue
    }

    const entryStarts: number[] = []
    for (let index = sectionStart + 1; index < sectionEnd; index += 1) {
      if (/^###\s+/.test(lines[index])) entryStarts.push(index)
    }
    if (!entryStarts.length) {
      const statements = lines
        .slice(sectionStart + 1, sectionEnd)
        .filter(line => isBusinessStatement(line, metadataValues))
      if (!statements.length) {
        if (sectionKind === 'work') emptyWorkEntries.push(sectionTitle || '未命名工作经历')
        else emptyProjectEntries.push(sectionTitle || '未命名项目经历')
      } else {
        businessStatementCount += statements.length
      }
      sectionStart = sectionEnd
      continue
    }

    for (let entryIndex = 0; entryIndex < entryStarts.length; entryIndex += 1) {
      const start = entryStarts[entryIndex]
      const end = entryStarts[entryIndex + 1] || sectionEnd
      const title = lines[start].replace(/^###\s+/, '').trim()
      const statements = lines.slice(start + 1, end).filter(line => isBusinessStatement(line, metadataValues))
      if (sectionKind === 'work' && /其他经历|补充经历/.test(title)) {
        continue
      }
      if (!statements.length) {
        if (sectionKind === 'work') emptyWorkEntries.push(title || '未命名工作经历')
        else emptyProjectEntries.push(title || '未命名项目经历')
      } else {
        businessStatementCount += statements.length
      }
    }
    sectionStart = sectionEnd
  }

  return { businessStatementCount, emptyWorkEntries, emptyProjectEntries }
}

export function evaluateMarkdownResume(markdown: string, sourceResume: ResumeStructure): EvaluationResult {
  const issues: EvaluationIssue[] = []
  const normalizedMarkdown = markdown.trim()
  const businessInspection = inspectBusinessSections(normalizedMarkdown, sourceResume)

  if (normalizedMarkdown.length < 200) {
    issues.push({
      severity: 'error',
      code: 'RESUME_TOO_SHORT',
      message: '优化简历内容过短，可能没有生成完整简历。',
    })
  }

  const hasExperienceSection = normalizedMarkdown.split(/\r?\n/).some(line => {
    const heading = line.match(/^##\s+(.+)/)
    return Boolean(heading && classifySectionTitle(heading[1]))
  })
  if (!hasExperienceSection) {
    issues.push({
      severity: 'error',
      code: 'MISSING_EXPERIENCE_SECTION',
      message: '优化简历缺少工作经历章节。',
    })
  }

  if (!/技能清单|专业技能|技能/.test(normalizedMarkdown)) {
    issues.push({
      severity: 'error',
      code: 'MISSING_SKILL_SECTION',
      message: '优化简历缺少技能章节。',
    })
  }

  for (const pattern of PLACEHOLDER_PATTERNS) {
    if (pattern.test(normalizedMarkdown)) {
      issues.push({
        severity: 'error',
        code: 'PLACEHOLDER_TEXT_FOUND',
        message: `优化简历包含模板占位文本：${pattern.source}`,
      })
    }
  }

  for (const title of businessInspection.emptyWorkEntries) {
    issues.push({
      severity: 'error',
      code: 'EMPTY_WORK_ENTRY',
      message: `工作经历“${title}”只有标题或元数据，没有可投递的业务正文。`,
      path: title,
    })
  }

  for (const title of businessInspection.emptyProjectEntries) {
    issues.push({
      severity: 'error',
      code: 'EMPTY_PROJECT_ENTRY',
      message: `项目经历“${title}”只有标题或元数据，没有可投递的业务正文。`,
      path: title,
    })
  }

  const minimumEvidenceCount = minimumBusinessEvidenceCount(sourceResume)
  if (businessInspection.businessStatementCount < minimumEvidenceCount) {
    issues.push({
      severity: 'warning',
      code: 'INSUFFICIENT_BUSINESS_EVIDENCE',
      message: `工作与项目正文仅有 ${businessInspection.businessStatementCount} 条有效内容，低于基于完整源材料估算的参考下限 ${minimumEvidenceCount} 条；请结合岗位计划确认是否过度裁剪。`,
    })
  }

  const sourceCompanies = sourceResume.experience.map((item) => item.company)
  if (sourceCompanies.length > 0 && !includesAny(normalizedMarkdown, sourceCompanies)) {
    issues.push({
      severity: 'warning',
      code: 'SOURCE_COMPANY_NOT_REFERENCED',
      message: '优化简历未明显引用源简历中的公司名称，请确认没有丢失工作经历。',
    })
  }

  const normalizedTimelineMarkdown = normalizeTimelineText(normalizedMarkdown)
  for (const item of sourceResume.experience) {
    const hasTimelineEntry = [item.company, item.position, item.time_range]
      .filter(Boolean)
      .every(value => normalizedTimelineMarkdown.includes(normalizeTimelineText(value)))
    if (!hasTimelineEntry) {
      issues.push({
        severity: 'error',
        code: 'MISSING_TIMELINE_ENTRY',
        message: `优化简历缺少完整职业时间线条目：${item.company}｜${item.position}｜${item.time_range}。`,
        path: item.company,
      })
    }
  }

  const hardSkills = sourceResume.skills.hard_skills
  if (hardSkills.length > 0 && !includesAny(normalizedMarkdown, hardSkills)) {
    issues.push({
      severity: 'warning',
      code: 'SOURCE_SKILLS_NOT_REFERENCED',
      message: '优化简历未明显引用源简历中的硬技能，请确认技能清单是否完整。',
    })
  }

  const errorCount = issues.filter((issue) => issue.severity === 'error').length
  const warningCount = issues.filter((issue) => issue.severity === 'warning').length
  const score = Math.max(0, 100 - errorCount * 30 - warningCount * 10)

  return {
    evaluatorName: 'markdown-resume-rules',
    evaluatorVersion: 'v2',
    passed: errorCount === 0,
    score,
    issues,
  }
}
