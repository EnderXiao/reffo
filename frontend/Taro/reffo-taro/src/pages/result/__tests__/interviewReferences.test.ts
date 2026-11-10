import {findBestOriginalQuote} from '../model/interviewReferences'

describe('interview references', () => {
  test('从岗位描述和源简历中提取真实原文引用', () => {
    const resume = [
      '在北京智佳科技有限责任公司使用 React Native 开发在线教育平台。',
      '负责用户权限管理、课程播放和作业提交等功能。',
    ].join('\n')
    const jd = [
      '岗位职责：负责在线教育平台前端开发。',
      '任职要求：熟悉 React Native，具备性能优化经验。',
    ].join('\n')

    expect(findBestOriginalQuote(resume, 'React Native 在线教育平台 用户权限')).toBe(
      '在北京智佳科技有限责任公司使用 React Native 开发在线教育平台。',
    )
    expect(findBestOriginalQuote(jd, 'React Native 性能优化')).toBe(
      '任职要求：熟悉 React Native，具备性能优化经验。',
    )
  })

  test('没有强匹配时也返回原文片段而不是占位符', () => {
    const jd = '岗位职责：负责业务系统前端开发。\n任职要求：关注组件封装和接口联调。'

    expect(findBestOriginalQuote(jd, '完全无关的查询')).toBe('岗位职责：负责业务系统前端开发。')
  })

  test('待完善行即使匹配更高也不能成为事实引用', () => {
    const completed = '负责门店调研，形成需求清单。'
    const pending = '负责 AI 辅导，具体完成【待完善：本人设计；如原型设计/规则梳理，仅选实际做过的项】。'
    const source = `## 工作经历\n- ${pending}\n- ${completed}`

    expect(findBestOriginalQuote(source, 'AI 辅导 原型设计 规则梳理')).toBe(completed)
    expect(findBestOriginalQuote(pending, 'AI 辅导')).toBe('')
  })

  test('不会删除括号后把未完成的残句当成引用', () => {
    const source = '将审核耗时降至【待完善：实际耗时；无记录则删除整句】。'

    expect(findBestOriginalQuote(source, '审核耗时')).toBe('')
  })
})
