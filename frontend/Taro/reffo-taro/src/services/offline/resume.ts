import presets from '../../pages/landing/config/presets.json'
import type {
  Education,
  InterviewSuggestions,
  MatchingResult,
  OptimizedResume,
  ProcessResult,
  Project,
  ResumeAnalysis,
  StructuredResume,
  WorkExperience,
} from '@/types'

interface PresetJobDescription {
  id: string
  title: string
  company: string
  location: string
  experience: string
  summary: string
  responsibilities: string[]
}

const presetJobs = presets.jobDescriptions as PresetJobDescription[]

const KNOWN_SKILLS = [
  'React', 'Vue', 'Angular', 'Next.js', 'Nuxt.js', 'Taro', 'UniApp', '小程序',
  'TypeScript', 'JavaScript', 'Node.js', 'Python', 'Java', 'Go', 'C++', 'C#',
  'HTML', 'CSS', 'Sass', 'Less', 'Webpack', 'Vite', 'Rollup', 'Babel',
  'React Native', 'Flutter', 'Swift', 'Kotlin', 'Android', 'iOS',
  'MySQL', 'PostgreSQL', 'MongoDB', 'Redis', 'Elasticsearch', 'ClickHouse',
  'SQL', 'NoSQL', 'GraphQL', 'REST', 'API', 'gRPC', '微服务', '分布式系统',
  'Docker', 'Kubernetes', 'Linux', 'Git', 'CI/CD', 'Jenkins', 'Nginx',
  'AWS', 'Azure', 'GCP', '阿里云', '腾讯云', '华为云', 'Supabase',
  'OpenAI', 'DeepSeek', 'LLM', 'Prompt', 'AIGC', 'RAG', 'Agent',
  'Figma', 'Sketch', 'Photoshop', 'Illustrator', 'After Effects',
  'Excel', 'PowerPoint', 'Tableau', 'Power BI', 'SPSS', 'SAS',
  'SEO', 'SEM', 'CRM', 'ERP', 'B端', 'C端', 'SaaS', 'A/B 测试',
  '敏捷开发', 'Scrum', 'OKR', 'KPI', '数据分析', '用户研究', '项目管理',
  '用户增长', '内容运营', '社群运营', '活动策划', '品牌策划', '市场营销',
  '前端开发', '后端开发', '全栈开发', '性能优化', '系统设计', '架构设计',
  '机器学习', '深度学习', '自然语言处理', '计算机视觉', '推荐系统',
]

const STOP_WORDS = {
  a: true,
  an: true,
  and: true,
  are: true,
  at: true,
  for: true,
  from: true,
  in: true,
  is: true,
  of: true,
  on: true,
  or: true,
  the: true,
  to: true,
  with: true,
  以上: true,
  优先: true,
  具备: true,
  岗位: true,
  工作: true,
  良好: true,
  相关: true,
  能力: true,
  负责: true,
  要求: true,
  熟悉: true,
} as Record<string, boolean>

const resumeMarkdownByAnalysis = new WeakMap<object, string>()
const experienceYearsByAnalysis = new WeakMap<object, number>()

function normalizeText(value: string) {
  let output = ''
  const source = String(value || '')

  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index)
    if (code >= 65281 && code <= 65374) {
      output += String.fromCharCode(code - 65248)
    } else if (code === 12288) {
      output += ' '
    } else {
      output += source.charAt(index)
    }
  }

  return output
    .replace(/\r\n?/g, '\n')
    .replace(/[•·▪◦]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim()
}

function compact(value: string) {
  return normalizeText(value).toLowerCase()
}

function countOccurrences(source: string, term: string) {
  const text = compact(source)
  const target = compact(term)
  if (!target) return 0

  let count = 0
  let offset = 0
  while (offset < text.length) {
    const index = text.indexOf(target, offset)
    if (index === -1) break
    count += 1
    offset = index + target.length
  }
  return count
}

function firstMatch(value: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = value.match(pattern)
    if (match?.[1]?.trim()) {
      return match[1].trim()
    }
  }
  return ''
}

function getSectionLines(lines: string[], keywords: string[]) {
  const startIndex = lines.findIndex(line => keywords.some(keyword => line.includes(keyword)))
  if (startIndex === -1) return []

  const sectionLines: string[] = []
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index]
    if (/^#{1,3}\s+/.test(line) && sectionLines.length > 0) break
    sectionLines.push(line)
  }
  return sectionLines
}

function getContentLines(lines: string[]) {
  return lines
    .map(line => line.replace(/^#{1,6}\s+/, '').replace(/^[-*+]\s+/, '').trim())
    .filter(line => line.length > 0)
}

function extractKnownSkills(text: string) {
  const normalized = compact(text)
  const seen = new Set<string>()
  const skills: string[] = []

  KNOWN_SKILLS.forEach(skill => {
    const key = compact(skill)
    if (normalized.includes(key) && !seen.has(key)) {
      seen.add(key)
      skills.push(skill)
    }
  })
  return skills
}

function extractExperienceYears(lines: string[], structured: StructuredResume) {
  const text = lines.join('\n')
  const stated = text.match(/(\d+(?:\.\d+)?)\s*年(?:以上)?(?:经验|工作经历|从业)/)
  if (stated) return Number(stated[1])

  const years: number[] = []
  structured.experience.concat(structured.projects as unknown as WorkExperience[]).forEach(item => {
    const range = item.time_range || ''
    const matches = range.match(/(19|20)\d{2}/g)
    matches?.forEach(year => years.push(Number(year)))
  })

  if (years.length === 0) return 0
  return Math.max(0, new Date().getFullYear() - Math.min(...years))
}

function buildStructuredResume(resumeText: string): StructuredResume {
  const normalized = normalizeText(resumeText)
  const lines = normalized.split('\n').map(line => line.trim())
  const name = firstMatch(normalized, [
    /姓名[:：]\s*([^\s，,。；;]+)/,
    /^#\s*([^\n]+)/m,
  ]) || firstMatch(normalized, [/^\s*([^\s，,。；;]{2,12})/m])

  const contact = firstMatch(normalized, [
    /(?:电话|手机|联系方式)[:：]?\s*([0-9+\-\s]{7,})/i,
  ])
  const email = firstMatch(normalized, [
    /([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i,
  ])
  const location = firstMatch(normalized, [
    /(?:所在城市|所在地|工作地|现居)[:：]?\s*([^\n，,。；;]+)/,
  ])

  const educationLines = getContentLines(getSectionLines(lines, ['教育背景', '教育经历', '学历']))
  const education: Education[] = educationLines.length > 0 ? [{
    school: educationLines[0].split(/[|｜]/)[0] || educationLines[0],
    degree: /硕士/.test(normalized) ? '硕士' : /博士/.test(normalized) ? '博士' : /本科/.test(normalized) ? '本科' : '',
    major: educationLines[0].split(/[|｜]/)[1] || '',
    time_range: educationLines.find(line => /(19|20)\d{2}/.test(line)) || '',
    achievements: educationLines.slice(1, 4),
  }] : []

  const experienceLines = getContentLines(getSectionLines(lines, ['工作经历', '工作经验', '实习经历', '职业经历']))
  const experience: WorkExperience[] = experienceLines.length > 0 ? [{
    company: experienceLines[0].split(/[|｜]/)[0] || '未填写公司',
    position: experienceLines[0].split(/[|｜]/)[1] || '未填写职位',
    time_range: experienceLines.find(line => /(19|20)\d{2}/.test(line)) || '',
    responsibilities: experienceLines.slice(1, 7),
    achievements: experienceLines.filter(line => /\d+(?:\.\d+)?\s*(?:%|％|万|人|次|个|项|年|倍)/.test(line)),
  }] : []

  const projectLines = getContentLines(getSectionLines(lines, ['项目经历', '项目经验', '代表项目']))
  const projects: Project[] = projectLines.length > 0 ? [{
    name: projectLines[0].split(/[|｜]/)[0] || '未填写项目',
    description: projectLines.slice(1, 5).join('；'),
    tech_stack: extractKnownSkills(projectLines.join(' ')),
    role: /负责|主导|独立/.test(projectLines.join(' ')) ? '核心参与' : '项目参与',
    achievements: projectLines.filter(line => /\d+(?:\.\d+)?\s*(?:%|％|万|人|次|个|项|年|倍)/.test(line)),
  }] : []

  return {
    personal_info: {
      name,
      contact,
      email,
      location,
      current_position: experience[0]?.position || '',
    },
    education,
    experience,
    projects,
    skills: {
      hard_skills: extractKnownSkills(normalized),
      soft_skills: ['沟通协作', '问题解决'].filter(skill => normalized.includes(skill.slice(0, 2))),
    },
  }
}

function getResumeLines(resumeText: string) {
  const normalized = normalizeText(resumeText)
  const lines = normalized.split('\n').map(line => line.trim()).filter(line => line.length >= 8)
  return lines.length >= 3 ? lines : normalized.split(/[。；;]+/).map(line => line.trim()).filter(line => line.length >= 8)
}

function analyzeQuantifiedAchievements(resumeText: string) {
  const lines = getResumeLines(resumeText)
  const quantified = lines.filter(line => {
    const impact = /(提升|降低|增长|完成|覆盖|服务|管理|节省|转化|上线|优化|达到|超过|交付|新增|留存|效率|规模)/.test(line)
    const quantity = /(\d+(?:\.\d+)?\s*(?:%|％|万|千|亿|人|次|条|个|项|天|日|周|月|年|倍|分|小时|台|家|款|篇|元|k|w|b|gb|mb|fps|bp))/i.test(line)
    const percent = /\d+(?:\.\d+)?\s*(?:%|％)/.test(line)
    return quantity && (impact || percent)
  })
  const percentCount = quantified.filter(line => /\d+(?:\.\d+)?\s*(?:%|％)/.test(line)).length
  const ratio = lines.length ? quantified.length / lines.length : 0
  return {
    quantified,
    score: Math.min(100, Math.round(Math.min(1, ratio / 0.45) * 55 + Math.min(1, quantified.length / 5) * 25 + Math.min(1, percentCount / 2) * 20)),
  }
}

function extractJdKeywords(jdText: string) {
  const normalized = normalizeText(jdText)
  const lower = compact(jdText)
  const candidates: Array<{value: string; count: number; priority: number}> = []
  const seen = new Set<string>()

  const add = (value: string, priority: number) => {
    const candidate = value.trim()
    const key = compact(candidate)
    if (candidate.length < 2 || candidate.length > 24 || STOP_WORDS[key] || seen.has(key)) return
    seen.add(key)
    candidates.push({
      value: candidate,
      count: countOccurrences(jdText, candidate),
      priority: priority + (/^[a-z][a-z0-9+#.\-_/]*$/i.test(candidate) ? 3 : 0) + (KNOWN_SKILLS.some(skill => compact(skill) === key) ? 8 : 0),
    })
  }

  KNOWN_SKILLS.forEach(skill => {
    if (lower.includes(compact(skill))) add(skill, 10)
  })
  const ascii = normalized.match(/[a-zA-Z][a-zA-Z0-9+#.\-_/]{1,24}/g) || []
  ascii.forEach(value => add(value, 4))
  normalized
    .split(/[\n，,。；;：:、|/（）()\[\]【】]+/)
    .map(value => value.replace(/^\s*(?:熟悉|掌握|了解|具备|负责|参与|支持|优先|要求|岗位职责|任职要求)[:：]?\s*/, '').trim())
    .forEach(value => {
      if (value.length >= 3 && value.length <= 16 && !/^\d/.test(value)) add(value, 1)
    })

  return candidates
    .sort((left, right) => right.priority - left.priority || right.count - left.count || right.value.length - left.value.length)
    .slice(0, 18)
    .map(item => item.value)
}

function resolveJdText(jd: string | {presetJdId: string}) {
  if (typeof jd === 'string') return normalizeText(jd)
  const preset = presetJobs.find(job => job.id === jd.presetJdId)
  if (!preset) throw new Error('预设岗位不存在')
  return normalizeText([
    `岗位名称：${preset.title}`,
    `公司：${preset.company}`,
    `工作地：${preset.location}`,
    preset.summary,
    ...preset.responsibilities,
  ].join('\n'))
}

function analyzeResume(resumeMarkdown: string, _options: {landing?: boolean} = {}): ResumeAnalysis {
  const resumeText = normalizeText(resumeMarkdown)
  if (resumeText.length < 10) {
    throw new Error('简历内容不能为空且至少需要 10 个字符')
  }

  const structured = buildStructuredResume(resumeText)
  const quantified = analyzeQuantifiedAchievements(resumeText)
  const presentSections = [
    structured.personal_info.name,
    structured.experience.length,
    structured.projects.length,
    structured.education.length,
    structured.skills.hard_skills.length,
  ].filter(Boolean).length
  const structureScore = Math.round((presentSections / 5) * 70 + Math.min(30, quantified.score * 0.3))
  const qualityScore = Math.min(100, Math.round(structureScore * 0.72 + quantified.score * 0.28))

  const analysis: ResumeAnalysis = {
    quality_score: qualityScore,
    strengths: [
      structured.experience.length > 0 ? '包含可识别的工作经历' : '简历内容已录入',
      quantified.quantified.length > 0 ? `识别到 ${quantified.quantified.length} 条量化成果` : '可继续补充结果数据',
      structured.skills.hard_skills.length > 0 ? `识别到 ${structured.skills.hard_skills.length} 项可匹配技能` : '建议补充专业技能清单',
    ],
    weaknesses: [
      quantified.quantified.length < 3 ? '量化成果密度偏低' : '部分经历仍可突出结果',
      structured.projects.length === 0 ? '未识别到项目经历' : '项目成果可进一步对应岗位要求',
    ],
    suggestions: [
      '用“动作 + 方法 + 结果”重写核心经历。',
      '把目标岗位最相关的关键词放到个人优势和最近经历中。',
      '没有数据支撑的内容不要补造，保留事实边界。',
    ],
    capability_summary: structured.skills.hard_skills.slice(0, 8).join('、') || '待补充专业技能',
    structured_resume: structured,
  }

  resumeMarkdownByAnalysis.set(analysis, resumeText)
  experienceYearsByAnalysis.set(analysis, extractExperienceYears(getResumeLines(resumeText), structured))
  return analysis
}

function matchResume(analysis: ResumeAnalysis, jd: string | {presetJdId: string}): MatchingResult {
  if (!analysis?.structured_resume) throw new Error('简历分析结果不存在')
  const jdText = resolveJdText(jd)
  if (jdText.length < 10) throw new Error('JD 内容不能为空且至少需要 10 个字符')

  const resumeText = resumeMarkdownByAnalysis.get(analysis) || JSON.stringify(analysis.structured_resume)
  const keywords = extractJdKeywords(jdText)
  const matchedSkills = keywords.filter(keyword => countOccurrences(resumeText, keyword) > 0)
  const missingSkills = keywords.filter(keyword => !matchedSkills.includes(keyword))
  const skillScore = keywords.length ? Math.round((matchedSkills.length / keywords.length) * 100) : analysis.quality_score
  const yearsRequiredMatch = jdText.match(/(\d+)\s*年以上/)
  const yearsRequired = yearsRequiredMatch ? Number(yearsRequiredMatch[1]) : 0
  const yearsActual = experienceYearsByAnalysis.get(analysis) || 0
  const experienceScore = yearsRequired ? Math.min(100, Math.round((yearsActual / yearsRequired) * 100)) : 75
  const matchScore = Math.max(0, Math.min(100, Math.round(skillScore * 0.72 + experienceScore * 0.18 + analysis.quality_score * 0.10)))
  const basicTitle = firstMatch(jdText, [
    /岗位名称[:：]\s*([^\n，,。；;]+)/,
    /(软件工程师|产品经理|数据分析师|UX 设计师|用户运营经理|前端工程师|后端工程师)/,
  ])
  const basicCompany = firstMatch(jdText, [
    /公司[:：]\s*([^\n，,。；;]+)/,
  ])

  return {
    match_score: matchScore,
    hard_requirements_match: [
      {
        requirement: yearsRequired ? `${yearsRequired} 年以上相关经验` : '岗位经验要求',
        matched: yearsRequired ? yearsActual >= yearsRequired : true,
        evidence: yearsActual ? `本地识别约 ${yearsActual} 年经历` : '未从简历识别到明确年限',
        suggestion: yearsRequired && yearsActual < yearsRequired ? '补充相关领域总年限和代表性项目证据' : undefined,
      },
      ...keywords.slice(0, 5).map(keyword => ({
        requirement: keyword,
        matched: matchedSkills.includes(keyword),
        evidence: matchedSkills.includes(keyword) ? '简历中已出现该关键词' : '当前简历未识别到明确证据',
        suggestion: matchedSkills.includes(keyword) ? undefined : `围绕真实经历补充与 ${keyword} 相关的成果证据`,
      })),
    ],
    skill_match: {
      matched_skills: matchedSkills,
      missing_skills: missingSkills,
      match_percentage: skillScore,
      required_skill_checks: keywords.slice(0, 10).map(keyword => ({
        requirement: keyword,
        status: matchedSkills.includes(keyword) ? 'matched' : 'missing',
        evidence: matchedSkills.includes(keyword) ? '简历中已出现' : '未识别到明确经历',
      })),
    },
    experience_match: {
      years_required: yearsRequired,
      years_actual: yearsActual,
      relevant_experience: analysis.structured_resume.experience.map(item => `${item.company}｜${item.position}`),
      match_percentage: experienceScore,
    },
    optimization_suggestions: [
      missingSkills.length > 0 ? `优先核对并自然融入：${missingSkills.slice(0, 8).join('、')}` : '关键词覆盖较完整，继续压缩重复描述。',
      yearsRequired && yearsActual < yearsRequired ? `明确说明与 ${yearsRequired} 年经验要求相关的真实年限和项目证据。` : '把最有岗位相关性的经历前置。',
      '每条核心经历补充动作、方法和可验证结果。',
    ],
    strengths: matchedSkills.slice(0, 6),
    weaknesses: missingSkills.slice(0, 6),
    weakness_details: missingSkills.slice(0, 6).map((keyword, index) => ({
      id: `local-gap-${index + 1}`,
      priority: index < 3 ? 'high' : 'medium',
      weakness: `缺少 ${keyword} 的明确证据`,
      evidence_type: 'direct_missing',
      jd_requirement: keyword,
      evidence: '当前简历未识别到该关键词',
      impact: '招聘方可能无法快速判断岗位匹配度',
      suggestion: `仅在真实经历支持时补充 ${keyword} 相关项目或成果`,
    })),
    optimization_strategy_details: missingSkills.slice(0, 3).map((keyword, index) => ({
      id: `local-strategy-${index + 1}`,
      related_gap_ids: [`local-gap-${index + 1}`],
      strategy_point: `围绕 ${keyword} 重组最相关经历`,
      rationale: '将已有事实改写为岗位可扫描的语言，不新增未经验证的信息。',
      optimization_example: {
        source_path: 'structured_resume.experience[0].responsibilities',
        source_quote: analysis.structured_resume.experience[0]?.responsibilities[0] || '',
        optimized_content: `在真实职责基础上补充与 ${keyword} 相关的动作、方法和结果数据。`,
      },
    })),
    context_fit: {
      company_alignment: basicCompany ? `目标公司：${basicCompany}` : '未识别到明确公司信息',
      location_alignment: '本地分析，未使用定位能力',
      hypotheses_used: ['关键词出现在简历即视为覆盖', '年限按日期或明确文本估算'],
    },
    jd_structure: {
      basic_info: {
        title: basicTitle || '目标岗位',
        company: basicCompany || undefined,
      },
      hard_requirements: {
        experience_years: yearsRequired ? `${yearsRequired} 年以上` : undefined,
        required_skills: keywords,
      },
      responsibilities: jdText.split('\n').map(line => line.trim()).filter(line => line.length > 0).slice(0, 10),
      tasks: [],
      soft_skills: ['沟通协作', '问题解决'],
      nice_to_have: missingSkills.slice(0, 5),
      uncertainties: ['离线规则只能识别文本信号，不能替代人工核实'],
    },
  }
}

function buildOptimizedResume(analysis: ResumeAnalysis, matching: MatchingResult): OptimizedResume {
  const structured = analysis.structured_resume
  const name = structured.personal_info.name || '候选人'
  const skills = Array.from(new Set([
    ...matching.skill_match.matched_skills,
    ...structured.skills.hard_skills,
  ])).slice(0, 20)

  const lines = [
    `# ${name}`,
    '',
    '## 个人优势',
    ...matching.skill_match.matched_skills.slice(0, 3).map(skill => `- 具备与目标岗位相关的 ${skill} 经历，建议在真实项目中突出动作与结果。`),
    '',
    '## 工作经历',
    ...structured.experience.flatMap(item => [
      `### ${item.company}｜${item.position}`,
      item.time_range || '',
      ...item.responsibilities.map(value => `- ${value}`),
      ...item.achievements.map(value => `- ${value}`),
      '',
    ]),
    '## 项目经历',
    ...structured.projects.flatMap(item => [
      `### ${item.name}`,
      item.description ? `- ${item.description}` : '- 请补充项目背景、个人职责和结果。',
      ...item.achievements.map(value => `- ${value}`),
      '',
    ]),
    '## 教育背景',
    ...structured.education.map(item => `- ${item.school}${item.major ? `｜${item.major}` : ''}${item.degree ? `｜${item.degree}` : ''}`),
    '',
    '## 专业技能',
    `- ${skills.join('、') || '请补充真实掌握的技能'}`,
  ]

  return {
    optimized_resume: lines.join('\n'),
    changes_summary: matching.optimization_suggestions,
    improvement_score: Math.max(0, matching.match_score - analysis.quality_score),
  }
}

function generateOptimizedResume(
  analysis: ResumeAnalysis,
  matching: MatchingResult,
  _options: {landing?: boolean; presetJdId?: string} = {},
): Promise<OptimizedResume> {
  if (!analysis?.structured_resume) return Promise.reject(new Error('简历分析结果不存在'))
  if (!matching) return Promise.reject(new Error('匹配分析结果不存在'))
  return Promise.resolve(buildOptimizedResume(analysis, matching))
}

function generateInterviewSuggestions(
  analysis: ResumeAnalysis,
  matching: MatchingResult,
  optimized: OptimizedResume,
  _options: {landing?: boolean; presetJdId?: string} = {},
): Promise<InterviewSuggestions> {
  if (!analysis || !matching || !optimized?.optimized_resume) {
    return Promise.reject(new Error('面试建议输入结果不存在'))
  }

  const skills = matching.skill_match.missing_skills.slice(0, 3)
  const questions = skills.length > 0
    ? skills.map(skill => `请用 STAR 方法说明你如何在真实项目中使用或接近 ${skill}。`)
    : [
        '请介绍一个你最有代表性的项目，以及你承担的核心职责。',
        '你如何衡量这段经历的业务结果？',
      ]

  return Promise.resolve({
    questions,
    story_recommendations: [
      {
        title: '最相关项目',
        background: analysis.structured_resume.projects[0]?.description || analysis.structured_resume.experience[0]?.responsibilities[0] || '选择一段与目标岗位最相关的真实经历。',
        result: analysis.structured_resume.projects[0]?.achievements[0] || '补充一个可验证的结果，没有数据时说明衡量方式。',
        storytelling_approach: ['先说明目标和约束', '再说明你的动作和方法', '最后说明结果与复盘'],
      },
    ],
    follow_up_questions: [
      '如果重做一次，你会优先优化哪个环节？',
      '这段经历中哪部分最能证明你匹配目标岗位？',
    ],
  })
}

function processResume(resumeMarkdown: string, jdText: string): Promise<ProcessResult> {
  if (resumeMarkdown.trim().length < 10) return Promise.reject(new Error('简历内容不能为空且至少需要 10 个字符'))
  if (jdText.trim().length < 10) return Promise.reject(new Error('JD 内容不能为空且至少需要 10 个字符'))

  const analysis = analyzeResume(resumeMarkdown)
  const matching = matchResume(analysis, jdText)
  const optimized = buildOptimizedResume(analysis, matching)
  return generateInterviewSuggestions(analysis, matching,optimized).then(interview => ({
    analysis,
    matching,
    optimized,
    interview,
  }))
}

export class ResumeApi {
  analyzeResume = analyzeResume
  matchResume = matchResume
  generateOptimizedResume = generateOptimizedResume
  generateInterviewSuggestions = generateInterviewSuggestions
  processResume = processResume
}

export const resumeApi = new ResumeApi()
