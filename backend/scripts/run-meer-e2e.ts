import { readFile } from 'node:fs/promises'

const baseUrl = process.env.REFFO_BASE_URL ?? 'http://127.0.0.1:3000/api/v1'
const pdfPath = process.env.MEER_RESUME_PDF ?? '../output/Meer（海双珑）求职源工作简历_2026-08-25.pdf'
const jdPath = process.env.MEER_JD_FILE
const token = process.env.REFFO_AUTH_TOKEN

const jdFallback = `公司：大梦龙途文化传播\n岗位：海外产品经理（C端）\n工作地点：长沙\n薪资：15-30K·13薪\n经验：3-5年\n学历：本科\n\n岗位职责\n1、产品战略与全盘规划：深耕垂直行业AI应用场景，结合市场痛点、技术趋势与公司资源，制定产品战略、发展路径及迭代规划。\n2、需求拆解与产品落地：精准拆解复杂业务与用户需求，搭建闭环产品逻辑，输出规范的PRD、原型与交互方案。\n3、数据复盘与迭代优化：搭建产品数据与复盘体系，持续跟踪核心数据反馈，深度定位业务问题与优化方向。\n4、行业洞察与壁垒构建：持续跟进AI行业动态、竞品策略与技术应用趋势，结合公司优势输出差异化创新方案。\n5、团队统筹与项目全盘推进：负责产品团队工作统筹、任务分工、成员能力赋能与团队氛围搭建。\n\n任职要求\n1、具备多年产品全盘操盘经验，拥有成熟的产品方法论与商业思维。\n2、具备产品团队统筹赋能、大型项目全盘操盘经验，擅长跨部门协同。\n3、具备创业型实干思维、目标感、抗压性、自驱力。\n4、具备AI产品落地经验优先，了解主流AI技术应用逻辑与落地边界。\n5、逻辑扎实、沟通统筹能力突出，能快速对齐团队目标。`

async function extractPdf(path: string) {
  const command = Bun.which('pdftotext')
    ? ['pdftotext', '-layout', path, '-']
    : ['python3', '-c', "import sys; from pypdf import PdfReader; print('\\n'.join((p.extract_text() or '') for p in PdfReader(sys.argv[1]).pages))", path]
  const proc = Bun.spawn(command, { stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited])
  if (exitCode !== 0) throw new Error(`pdftotext failed (${exitCode}): ${stderr.slice(0, 200)}`)
  if (stdout.trim().length < 10) throw new Error('PDF 未提取到足够文本')
  return stdout
}

async function request(path: string, body: unknown, timeoutMs: number) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'POST', headers: {'content-type': 'application/json', ...(token ? {authorization: `Bearer ${token}`} : {})},
      body: JSON.stringify(body), signal: controller.signal,
    })
    const json = await response.json() as Record<string, unknown>
    if (!response.ok || json.success === false) {
      const error = json.error as Record<string, unknown> | undefined
      throw new Error(`${path} HTTP ${response.status} ${String(error?.code ?? 'UNKNOWN')}: ${String(error?.message ?? '')}`)
    }
    return json
  } finally { clearTimeout(timer) }
}

const resumeMarkdown = await extractPdf(pdfPath)
const jdText = jdPath ? await readFile(jdPath, 'utf8') : jdFallback
console.log(JSON.stringify({stage: 'input', resumeChars: resumeMarkdown.length, jdChars: jdText.length}))

const analyzed = await request('/mvp/analyze', {resume_markdown: resumeMarkdown}, 120_000)
const analysis = ('analysis' in analyzed ? analyzed.analysis : analyzed) as Record<string, unknown>
const structuredResume = analysis.structured_resume
console.log(JSON.stringify({stage: 'analyze', success: true, structuredResume: Boolean(structuredResume)}))

const matched = await request('/mvp/match', {structured_resume: structuredResume, jd_text: jdText}, 240_000)
const matching = ('data' in matched ? matched.data : matched) as Record<string, unknown>
console.log(JSON.stringify({stage: 'match', success: true, keys: Object.keys(matching), matchScore: matching.match_score ?? null}))

const generated = await request('/mvp/generate', {structured_resume: structuredResume, matching}, 120_000)
const result = ('data' in generated ? generated.data : generated) as Record<string, unknown>
console.log(JSON.stringify({stage: 'generate', success: true, optimizedResumeChars: String(result.optimized_resume ?? '').length}))
console.log(JSON.stringify({stage: 'complete', success: true}))
