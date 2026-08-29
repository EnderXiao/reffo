import {parseComplianceInline, parseComplianceMarkdown} from '../complianceMarkdown'

describe('complianceMarkdown', () => {
  test('解析粗体、行内代码和外链', () => {
    expect(parseComplianceInline('请阅读**重点条款**，键名为 `reffo.cache`，参见[官方规则](https://example.com/rule)。')).toEqual([
      {type: 'text', text: '请阅读'},
      {type: 'strong', text: '重点条款'},
      {type: 'text', text: '，键名为 '},
      {type: 'code', text: 'reffo.cache'},
      {type: 'text', text: '，参见'},
      {type: 'link', text: '官方规则', href: 'https://example.com/rule'},
      {type: 'text', text: '。'},
    ])
  })

  test('解析表格并跳过分隔行', () => {
    const blocks = parseComplianceMarkdown(`| 场景 | 内容 |
|---|---|
| 登录 | **邮箱** |
| 缓存 | \`localStorage\` |`)

    expect(blocks).toEqual([{
      type: 'table',
      headers: [
        [{type: 'text', text: '场景'}],
        [{type: 'text', text: '内容'}],
      ],
      rows: [
        [[{type: 'text', text: '登录'}], [{type: 'strong', text: '邮箱'}]],
        [[{type: 'text', text: '缓存'}], [{type: 'code', text: 'localStorage'}]],
      ],
    }])
  })

  test('保留有序列表序号并解析标题和引用', () => {
    const blocks = parseComplianceMarkdown(`# 标题
1. 第一项
12. 第十二项
> 提示`)

    expect(blocks.map(block => block.type)).toEqual(['h1', 'li', 'li', 'quote'])
    expect(blocks[1]).toMatchObject({type: 'li', marker: '1.'})
    expect(blocks[2]).toMatchObject({type: 'li', marker: '12.'})
  })

  test('表格支持转义竖线和代码中的竖线', () => {
    const blocks = parseComplianceMarkdown(`| 名称 | 内容 |
|---|---|
| A \\| B | \`left|right\` |`)

    expect(blocks[0]).toMatchObject({
      type: 'table',
      rows: [[
        [{type: 'text', text: 'A | B'}],
        [{type: 'code', text: 'left|right'}],
      ]],
    })
  })
})
