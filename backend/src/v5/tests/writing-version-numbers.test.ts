import {describe, expect, test} from 'bun:test'
import {buildWritingFact, inspectSupportedWriting, writingNumbers} from '@/v5/writing/facts'
import {createV5ResultFixture} from './fixtures'

const template = createV5ResultFixture().resumeEvidenceBundle.evidenceAtoms.find(atom => atom.claimType === 'deliverable')!
const source = (verbatimText: string) => ({...template, verbatimText, numericAtoms: [], qualifiers: [], riskFlags: []})
const numberErrors = (text: string, original: string) => inspectSupportedWriting(text, [source(original)], 'experience.work.bullets[0]')
  .filter(issue => issue.code === 'WRITER_NUMBER_CHANGED')

describe('version numbers next to an explicit conjunction', () => {
  test('a spaced plus joining two deliverables is not a minimum-version qualifier', () => {
    const original = '产品重构方案 V1.0 + PC 配置端交互原型'
    expect(writingNumbers(original)).toEqual(['1.0'])
    expect(buildWritingFact(source(original))!.protectedNumbers).toEqual(['1.0'])
    expect(numberErrors('产品重构方案V1.0加PC配置端交互原型。', original)).toEqual([])
    expect(numberErrors('产品重构方案V1.1加PC配置端交互原型。', original)).toHaveLength(1)
  })

  test('changed versions remain blocked across multiple cited deliverables', () => {
    const sources = [source('工作任务系统2.0重构方案'), source('产品重构方案 V1.0 + PC 配置端交互原型')]
    const codes = (text: string) => inspectSupportedWriting(text, sources, 'body').map(issue => issue.code)
    expect(codes('产出工作任务系统2.0重构方案与产品重构方案V1.0加PC配置端交互原型。')).not.toContain('WRITER_NUMBER_CHANGED')
    expect(codes('产出工作任务系统3.0重构方案与产品重构方案V1.0加PC配置端交互原型。')).toContain('WRITER_NUMBER_CHANGED')
  })

  test.each([
    ['支持V1.0+。', '支持V1.0。'],
    ['交付100+份。', '交付100份。'],
    ['交付约100份。', '交付100份。'],
    ['交付1.0+版本。', '交付1.0版本。'],
    ['服务100 + 人。', '服务100人。'],
  ])('does not erase a real qualifier from %s', (original, text) => {
    expect(numberErrors(text, original)).toHaveLength(1)
  })

  test('the narrow version rule does not normalize arbitrary arithmetic or quantity plus signs', () => {
    expect(writingNumbers('交付1.0 + PC原型。')).toEqual(['1.0+'])
    expect(writingNumbers('版本V1.0 + 2.0。')).toEqual(['1.0+', '2.0'])
    expect(writingNumbers('V1.0+ PC原型。')).toEqual(['1.0+'])
    expect(writingNumbers('支持V1.0 + 以上版本。')).toEqual(['1.0+'])
    expect(writingNumbers('supports V1.0 + or later.')).toEqual(['1.0+'])
  })
})
