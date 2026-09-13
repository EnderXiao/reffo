import { describe, expect, test } from 'bun:test'
import type { EvidenceAtom } from '@/v5/types'
import { buildWritingFact, inspectSupportedWriting, writingNumbers } from '@/v5/writing/facts'

function sourceAtom(text: string): EvidenceAtom {
  return {
    evidenceId: 'source-voice-project', sourceDocumentHash: 'test-source', sourceBlockId: 'B0183',
    sourceScopeId: 'voice-project', sourceSpan: { start: 0, end: text.length },
    verbatimText: text, normalizedClaim: text, claimType: 'other', status: 'source_supported',
    attributionLevel: 'unspecified', sourceActionVerb: null, qualifiers: [], numericAtoms: [], riskFlags: [],
  }
}

const numberIssues = (source: string, output: string) => inspectSupportedWriting(
  output, [sourceAtom(source)], 'project.voice-project.bullets[0]',
).filter(issue => issue.code === 'WRITER_NUMBER_CHANGED')

describe('source-backed numeric expression equivalence', () => {
  test('accepts the real voice-project regression without changing source or generated text', () => {
    const source = sourceAtom('## 一线服务保障B端语音播报0-1')
    const before = structuredClone(source)
    const output = '一线服务保障B端语音播报从0到1，需要先弄清一线在哪些环节需要提醒、提醒以什么方式触达才有效。'
    expect(inspectSupportedWriting(output, [source], 'project.voice-project.bullets[0]')).toEqual([])
    expect(buildWritingFact(source)?.protectedNumbers).toEqual(['0-1'])
    expect(writingNumbers(output)).toEqual(['0-1'])
    expect(source).toEqual(before)
  })

  test.each([
    ['语音播报0-1', '语音播报从0到1'],
    ['语音播报从0到1', '语音播报0-1'],
    ['语音播报0 - 1', '语音播报从０ 到 １'],
    ['负责3-5个项目', '负责3到5个项目'],
    ['响应时间约0.5-1.5秒', '响应时间约0.5到1.5秒'],
    ['访问量0-1万', '访问量从0到1万'],
  ])('preserves the full supported numeric expression: %s → %s', (source, output) => {
    expect(numberIssues(source, output)).toEqual([])
  })

  test.each([
    ['语音播报0-1', '语音播报从0到2'],
    ['语音播报0-1', '语音播报从1到0'],
    ['语音播报0-1', '语音播报从0到100'],
    ['语音播报0-1', '服务用户从0到1万'],
    ['语音播报0-1', '收入从0到1万元'],
    ['语音播报0-1', '增长从0到1%'],
    ['语音播报0-1', '语音播报从0到1，交付10个功能'],
    ['语音播报0-1', '交付0或1'],
    ['负责3-5个项目', '负责3到6个项目'],
    ['负责3-5个项目', '负责3到5项项目'],
    ['负责约3-5个项目', '负责3到5个项目'],
    ['访问量0-1万', '访问量从0到1'],
    ['访问量0-1万', '访问量从0到1亿'],
    ['访问量0-1万+', '访问量从0到1万'],
    ['访问量0-1万', '访问量从0到1万+'],
    ['实验组0与对照组1', '产品从0到1孵化'],
    ['参与产品需求梳理与上线', '产品从0到1孵化'],
    ['参与语音播报需求梳理', '语音播报从0到1'],
  ])('rejects unsupported endpoints, units, qualifiers and invented ranges: %s → %s', (source, output) => {
    expect(numberIssues(source, output)).not.toEqual([])
  })

  test('does not authorize a zero-to-one claim without cited evidence', () => {
    expect(inspectSupportedWriting('完成产品从0到1孵化。', [], 'summary[0]').map(issue => issue.code))
      .toContain('WRITER_NUMBER_CHANGED')
  })
})
