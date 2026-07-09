import {
  extractJobMetadataFromOcrText,
  normalizeCompanyNameCandidate,
  resolvePositionNameCandidate,
} from '../jobMetadata'

describe('jobMetadata', () => {
  test('从招聘截图 OCR 文本提取公司和真实岗位标题', () => {
    const metadata = extractJobMetadataFromOcrText(
      '万兴科技正在招聘\n# 产品策划经理\n长沙/25-50K·15薪/3-5年/本科\n## 职位详情',
    )

    expect(metadata).toEqual({
      companyName: '万兴科技',
      positionName: '产品策划经理',
    })
  })

  test('结构化岗位名是招聘口号时回退到 OCR 标题岗位', () => {
    expect(resolvePositionNameCandidate('万兴科技正在招聘', '产品策划经理'))
      .toBe('产品策划经理')
  })

  test('保留招聘经理这类真实岗位名称', () => {
    expect(resolvePositionNameCandidate('招聘经理', '产品策划经理'))
      .toBe('招聘经理')
  })

  test('规范化中英文混排公司名', () => {
    expect(normalizeCompanyNameCandidate('芒果tv正在招聘')).toBe('芒果 TV')
  })
})
