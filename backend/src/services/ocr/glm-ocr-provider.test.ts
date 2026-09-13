import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { env } from '@/config/env'
import { GlmOcrProvider } from '@/services/ocr/glm-ocr-provider'

describe('GlmOcrProvider job description structure', () => {
  const originalFetch = globalThis.fetch
  const originalApiKey = env.GLM_OCR_API_KEY

  beforeEach(() => {
    env.GLM_OCR_API_KEY = 'test-ocr-key'
  })

  afterEach(() => {
    env.GLM_OCR_API_KEY = originalApiKey
    globalThis.fetch = originalFetch
  })

  async function parseOcrText(markdown: string) {
    globalThis.fetch = mock(async () => Response.json({ markdown })) as unknown as typeof fetch
    return new GlmOcrProvider().parseDocument({
      fileName: 'jd.jpg',
      fileType: 'image',
      mimeType: 'image/jpeg',
      buffer: new ArrayBuffer(0),
      purpose: 'jobDescription',
    })
  }

  test('extracts recruiting headings and keeps all numbered items in their declared sections', async () => {
    const duties = [
      '产品战略与全盘规划：负责AI产品从0到1孵化。',
      '需求拆解与产品落地：精准拆解复杂业务与用户需求。',
      '数据复盘与迭代优化：搭建产品数据与复盘体系。',
      '行业洞察与壁垒构建：持续跟进AI行业动态；联动各业务端。',
      '团队统筹与项目全盘推进：负责产品团队工作统筹。',
    ]
    const qualifications = [
      '战略视野与产品判断力：具备独立负责整条产品线的能力。',
      '团队统筹与项目全局把控：具备产品团队统筹赋能经验。',
      '创业心态与自驱行动力：目标感、抗压性、自驱力极强。',
      '具备AI产品落地经验优先：了解主流AI技术应用逻辑。',
      '逻辑扎实与高效协作：拥有结构化闭环思维。',
    ]
    const text = [
      '# 大梦龙途文化传播正在招聘',
      '# 海外产品经理（c端）',
      '长沙/15-30K·13薪/3-5年/本科',
      '## 职位详情',
      '## 岗位职责',
      ...duties.map((item, index) => `${index + 1}、${item}`),
      '## 任职要求',
      ...qualifications.map((item, index) => `${index + 1}、${item}`),
      'BOSS ZHIPIN',
      '扫码查看职位详情找工作，BOSS直聘直接谈！',
      '![](page=0,bbox=[759, 3806, 1004, 4053])',
    ].join('\n\n')

    const result = await parseOcrText(text)

    expect(result.structured).toEqual({
      companyName: '大梦龙途文化传播',
      positionName: '海外产品经理（c端）',
      jdText: text,
      responsibilities: duties,
      requirements: qualifications,
    })
    expect(result.rawText).toBe(text)
  })

  test('supports plain section headings, wrapped items and Chinese or Markdown list markers', async () => {
    const result = await parseOcrText([
      '公司：示例科技',
      '职位名称：产品经理',
      '岗位职责：',
      '一、拆解业务需求，',
      '并推动产品落地。',
      '（二）建设数据体系。',
      '任职资格',
      '- 具备独立负责产品线的能力。',
      '* 擅长团队协作。',
      '福利待遇',
      '免费工作餐。',
    ].join('\n'))

    expect(result.structured).toMatchObject({
      companyName: '示例科技',
      positionName: '产品经理',
      responsibilities: ['拆解业务需求，\n并推动产品落地。', '建设数据体系。'],
      requirements: ['具备独立负责产品线的能力。', '擅长团队协作。'],
    })
  })

  test('does not classify unsectioned prose merely because it includes responsibility keywords', async () => {
    const result = await parseOcrText('# 职位详情\n要求具备独立负责产品线的能力。')

    expect(result.structured).toMatchObject({
      companyName: '',
      positionName: '',
      responsibilities: [],
      requirements: [],
    })
    expect(result.structured?.jdText).toContain('要求具备独立负责产品线的能力。')
  })

  test('keeps decimals in unnumbered requirements and stops at a QR advertisement without a brand line', async () => {
    const result = await parseOcrText('## 任职要求\n1.5年以上经验。\n\n扫码查看职位详情\n欢迎投递。')

    expect(result.structured?.requirements).toEqual(['1.5年以上经验。'])
  })

  test('keeps compatibility with structured JSON OCR responses', async () => {
    const result = await parseOcrText('```json\n' + JSON.stringify({
      company_name: ' 示例科技 ',
      position_name: ' 产品经理 ',
      jd_text: '岗位职责：推动产品落地。\n任职要求：具备相关经验。',
      responsibilities: ['推动产品落地。'],
      requirements: ['具备相关经验。'],
    }) + '\n```')

    expect(result.structured).toEqual({
      companyName: '示例科技',
      positionName: '产品经理',
      jdText: '岗位职责：推动产品落地。\n任职要求：具备相关经验。',
      responsibilities: ['推动产品落地。'],
      requirements: ['具备相关经验。'],
    })
  })
})
