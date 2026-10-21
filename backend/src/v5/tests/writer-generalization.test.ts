import { describe, expect, test } from 'bun:test'
import { compileV5Prompt } from '@/v5/prompt-compiler'
import { canonicalizeSourceDocument } from '@/v5/canonical-source'
import { inspectSupportedWriting } from '@/v5/writing/facts'
import type { EvidenceAtom } from '@/v5/types'

function sourceAtom(text: string): EvidenceAtom {
  const document = canonicalizeSourceDocument(text, 'synthetic').canonicalDocument
  const block = document.blocks[0]
  return { evidenceId: 'evidence:synthetic', sourceDocumentHash: document.sha256,
    sourceScopeId: 'scope:synthetic', sourceBlockId: block.sourceBlockId,
    sourceSpan: { start: block.canonicalStart, end: block.canonicalEnd },
    verbatimText: text, normalizedClaim: text, claimType: 'action', status: 'source_supported',
    attributionLevel: 'unspecified', sourceActionVerb: null, qualifiers: [], numericAtoms: [], riskFlags: [] }
}

describe('generic Writer contract regression (synthetic, not model quality)', () => {
  test('uses language-aware soft length guidance without changing response or output allowance', () => {
    const prompt = compileV5Prompt({ component: 'P06C', envelope: { payload: { writingPolicy: 'supported-writing-v1' } } })
    const system = prompt.messages[0].content
    expect(prompt.promptVersion).toBe('5.1.0-p06c-supported-writer-r16')
    expect(prompt.maxOutputTokens).toBe(4320)
    expect(system).toContain('lengthHint 和 outputLength.unit')
    expect(system).toContain('不从年龄或头衔推断能力')
    expect(system).toContain('不是待填经历模板')
    expect(system).toContain('尚未上线也可以有价值')
    expect(system).toContain('不把方法标签接在整句原文前')
    expect(system).toContain('不枚举全部业务线和通用流程')
    expect(system).not.toContain('40–100')
    expect(system).not.toContain('130 字')
    expect(prompt.schema.safeParse({ contractVersion: 'p06-composition-v1', blocks: [] }).success).toBe(true)
  })

  test.each([
    ['sales', '负责客户需求整理，跟进合同进度。', '负责客户需求梳理与合同进度跟进。'],
    ['finance', '核对报销单据，整理异常事项。', '核对报销单据并整理异常事项。'],
    ['service', '接待来访人员，维护预约信息。', '负责来访接待与预约信息维护。'],
    ['graduate', '参与课程小组调研，制作展示作品。', '参与课程小组调研与展示作品制作。'],
    ['research', '设计研究方案并制作概念原型，尚未上线。', '完成研究方案设计与概念原型制作，尚未上线。'],
    ['management', '协调部门排期，组织阶段复盘。', '协调部门排期并组织阶段复盘。'],
    ['english', 'Reviewed customer feedback and prepared service notes.', 'Prepared service notes based on reviewed customer feedback.'],
  ])('allows source-supported non-quantified expression for %s', (_kind, source, output) => {
    expect(inspectSupportedWriting(output, [sourceAtom(source)], 'body')).toEqual([])
  })

  test('removing a result or changing delivery stage cannot leave the old claim behind', () => {
    const output = '负责客户跟进，签约12家。'
    expect(inspectSupportedWriting(output, [sourceAtom(output)], 'body')).toEqual([])
    expect(inspectSupportedWriting(output, [sourceAtom('负责客户跟进。')], 'body').map(issue => issue.code)).toContain('WRITER_NUMBER_CHANGED')
    expect(inspectSupportedWriting('完成方案并上线。', [sourceAtom('完成概念方案，尚未上线。')], 'body')
      .map(issue => issue.code)).toContain('WRITER_BOUNDARY_LOST')
  })
})
