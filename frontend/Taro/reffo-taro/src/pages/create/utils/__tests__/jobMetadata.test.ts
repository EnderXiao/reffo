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
      baseLocation: '长沙',
    })
  })

  test('从显式工作地点字段提取 base 地', () => {
    const metadata = extractJobMetadataFromOcrText(
      '字节跳动正在招聘\n# 前端开发工程师\n工作地点：上海\n## 职位详情',
    )

    expect(metadata.baseLocation).toBe('上海')
  })

  test('过滤招聘平台 UI 文案并从 HR 行提取公司', () => {
    const metadata = extractJobMetadataFromOcrText(
      [
        '## web前端研发工程师（2027届）25-45K * 16薪',
        '匹配度分析',
        '前端工程师上海本科',
        '收藏',
        '立即申请',
        '![](page=0,bbox=[36, 243, 159, 366])',
        '## 谢女士 9分钟前在线',
        '上海寻梦信息技术有限公司·HR',
        '反馈率：3%',
        '优 我公司正在参加27届Special Offer专场活动',
        '## 岗位职责',
        '负责公司核心产品的前端开发',
      ].join('\n'),
    )

    expect(metadata.companyName).toBe('上海寻梦信息技术有限公司')
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
