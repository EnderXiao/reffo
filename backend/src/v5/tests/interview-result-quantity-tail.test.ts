import {describe, expect, test} from 'bun:test'
import {createHash} from 'node:crypto'
import {bindSourceLineContinuations, sourceLineBlockBinding} from '@/v5/composition/source-continuation-proof'
import {interviewDeliveredArtifactOptions, interviewResultEvidenceAtoms, projectInterviewKnownResult} from '@/v5/interview-results'
import type {CanonicalSourceDocument, EvidenceAtom} from '@/v5/types'

function fixture(tailText = '家门店调研、访谈和埋点，形成问卷研究、埋点分析和重构方向材料', separator = '\n') {
  const texts = ['关键动作 主导问卷、10+', tailText], source = texts.join(separator)
  const hash = createHash('sha256').update(source).digest('hex')
  let offset = 0
  const atoms: EvidenceAtom[] = texts.map((text, index) => {
    const start = offset
    offset += text.length + separator.length
    return {evidenceId: `quantity-${index}`, sourceDocumentHash: hash, sourceBlockId: `B000${index + 1}`, sourceScopeId: 'research',
      sourceSpan: {start, end: start + text.length}, verbatimText: text, normalizedClaim: text, claimType: 'action', status: 'source_supported',
      attributionLevel: 'unspecified', sourceActionVerb: null, qualifiers: [], numericAtoms: [], riskFlags: []}
  })
  const bindProof = () => {
    const blocks = atoms.map(atom => ({sourceBlockId: atom.sourceBlockId, canonicalStart: atom.sourceSpan.start, canonicalEnd: atom.sourceSpan.end,
      text: atom.verbatimText, sectionHint: null, inputRiskFlags: []}))
    const document: CanonicalSourceDocument = {documentId: 'source', sha256: hash, primaryLanguage: 'zh-CN', canonicalLength: source.length,
      blocks, sourceLineContinuations: [{previousBlockId: blocks[0]!.sourceBlockId, currentBlockId: blocks[1]!.sourceBlockId,
        separator, binding: sourceLineBlockBinding(hash, blocks[0]!, blocks[1]!, separator)}]}
    bindSourceLineContinuations(document, atoms)
  }
  return {atoms, source, tailText, bindProof}
}

describe('completed deliverable inside a proven split quantity tail', () => {
  test('projects a cited legacy fragment to its own complete literal deliverable with source proof', () => {
    const f = fixture(), before = structuredClone(f.atoms)
    expect(projectInterviewKnownResult(f.tailText + '。', ['quantity-1'], f.atoms, f.source))
      .toBe('形成问卷研究、埋点分析和重构方向材料。')
    expect(f.atoms).toEqual(before)
  })

  test('new artifact options use the complete clause only with a stored layout proof', () => {
    const f = fixture(undefined, '\n\n')
    expect(interviewDeliveredArtifactOptions(f.atoms)[0]!.text).toBe(f.tailText)
    f.bindProof()
    expect(interviewDeliveredArtifactOptions(f.atoms)).toEqual([{evidenceId: 'quantity-1', sourceScopeId: 'research',
      text: '形成问卷研究、埋点分析和重构方向材料'}])
    expect(interviewResultEvidenceAtoms(['quantity-1'], f.atoms, '形成问卷研究、埋点分析和重构方向材料。')).toEqual([f.atoms[1]!])
  })

  test('preserves qualifiers following the completed clause rather than deleting them', () => {
    const f = fixture('家门店调研，形成研究报告，尚未上线且业务收益待验证')
    expect(projectInterviewKnownResult(f.tailText, ['quantity-1'], f.atoms, f.source))
      .toBe('形成研究报告，尚未上线且业务收益待验证')
    expect(interviewDeliveredArtifactOptions(f.atoms)).toEqual([])
  })

  test('leaves complete dated and quantitative outcomes intact', () => {
    for (const text of ['2025.08.15成果表记录回收答卷367份，形成使用研究材料', '10+家门店调研，形成研究报告',
      '主导10+家门店调研，形成研究报告', '家门店调研，报告仍待形成']) {
      const f = fixture(text)
      expect(projectInterviewKnownResult(text, ['quantity-1'], f.atoms, f.source)).toBe(text)
    }
  })

  test.each(['no_source', 'wrong_source', 'uncited', 'cross_scope', 'cross_hash', 'block_gap', 'bad_span', 'overlap', 'table_separator', 'duplicate_block', 'complete_prefix', 'no_deliverable', 'prefix_qualifier'] as const)
    ('does not trim an unproven or semantically incomplete fragment: %s', mutation => {
      const f = fixture()
      let source: string | undefined = f.source, ids = ['quantity-1']
      if (mutation === 'no_source') source = undefined
      if (mutation === 'wrong_source') source += 'modified'
      if (mutation === 'uncited') ids = []
      if (mutation === 'cross_scope') f.atoms[0]!.sourceScopeId = 'other'
      if (mutation === 'cross_hash') f.atoms[0]!.sourceDocumentHash = 'other'
      if (mutation === 'block_gap') f.atoms[0]!.sourceBlockId = 'B0000'
      if (mutation === 'bad_span') f.atoms[0]!.sourceSpan.end++
      if (mutation === 'overlap') f.atoms[1]!.sourceSpan.start--
      if (mutation === 'table_separator') {
        const replacement = fixture(undefined, '\t')
        f.atoms = replacement.atoms
        source = replacement.source
      }
      if (mutation === 'duplicate_block') f.atoms.push({...f.atoms[0]!, evidenceId: 'duplicate'})
      if (mutation === 'complete_prefix') f.atoms[0]!.verbatimText += '家门店。'
      if (mutation === 'no_deliverable') f.atoms[1]!.verbatimText = '家门店调研，仍需验证方案'
      if (mutation === 'prefix_qualifier') f.atoms[1]!.verbatimText = '家门店调研未完成，形成研究报告'
      const result = f.atoms[1]!.verbatimText
      expect(projectInterviewKnownResult(result, ids, f.atoms, source)).toBe(result)
    })
})
