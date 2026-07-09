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
const EXPERIENCE_SECTION_PATTERN = /工作经历|工作经验|职业经历|项目经历|项目经验|实习经历|实习经验|实践经历|实践经验/

function includesAny(markdown: string, values: string[]) {
  return values.some((value) => value.trim() && markdown.includes(value.trim()))
}

export function evaluateMarkdownResume(markdown: string, sourceResume: ResumeStructure): EvaluationResult {
  const issues: EvaluationIssue[] = []
  const normalizedMarkdown = markdown.trim()

  if (normalizedMarkdown.length < 200) {
    issues.push({
      severity: 'error',
      code: 'RESUME_TOO_SHORT',
      message: '优化简历内容过短，可能没有生成完整简历。',
    })
  }

  if (!EXPERIENCE_SECTION_PATTERN.test(normalizedMarkdown)) {
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

  const sourceCompanies = sourceResume.experience.map((item) => item.company)
  if (sourceCompanies.length > 0 && !includesAny(normalizedMarkdown, sourceCompanies)) {
    issues.push({
      severity: 'warning',
      code: 'SOURCE_COMPANY_NOT_REFERENCED',
      message: '优化简历未明显引用源简历中的公司名称，请确认没有丢失工作经历。',
    })
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
    evaluatorVersion: 'v1',
    passed: errorCount === 0,
    score,
    issues,
  }
}
