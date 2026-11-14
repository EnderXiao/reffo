import { describe, expect, test } from 'bun:test'
import type { EvidenceAtom } from '@/v5/types'
import { findInterviewResultContinuations, hasIncompleteInterviewResult, interviewResultEvidenceAtoms, interviewDeliveredArtifactOptions } from '@/v5/interview-results'

function fixture() {
  const leftText = '结果/边界个人材料记录：门店目标下发及时率由 57.4%提升至 90.7% ，员工目标下发及时率由 43.3%提升至'
  const rightText = '68. 4%。同一述职材料另有2025.05基线 79.2%/45.5%，使用时必须保留月份口径。'
  const left: EvidenceAtom = { evidenceId: 'result', sourceDocumentHash: 'source-document', sourceBlockId: 'B0089', sourceScopeId: 'target-project',
    sourceSpan: { start: 1971, end: 1971 + leftText.length }, verbatimText: leftText, normalizedClaim: leftText,
    claimType: 'result', status: 'source_qualified', attributionLevel: 'unspecified', sourceActionVerb: null,
    qualifiers: ['个人材料记录'], numericAtoms: [], riskFlags: ['uncertain'] }
  const right: EvidenceAtom = { ...left, evidenceId: 'tail', sourceBlockId: 'B0090', claimType: 'other',
    sourceSpan: { start: left.sourceSpan.end + 2, end: left.sourceSpan.end + 2 + rightText.length },
    verbatimText: rightText, normalizedClaim: rightText, qualifiers: ['同一述职材料另有2025.05基线 79.2%/45.5%', '使用时必须保留月份口径'] }
  return { left, right, atoms: [left, right] }
}

describe('interview result continuation and completeness', () => {
  test('a completed research artifact is supported literally without implying adoption or business impact', () => {
    const text='用户研究：主导问卷、10+家门店调研、访谈、埋点与行为分析；2025.08.15成果表记录回收答卷367份，形成使用研究、埋点分析及重优化方向材料。'
    const atom:EvidenceAtom={...fixture().left,evidenceId:'research',claimType:'action',status:'source_supported',riskFlags:[],qualifiers:[],verbatimText:text,normalizedClaim:text}
    const outcome='2025.08.15成果表记录回收答卷367份，形成使用研究、埋点分析及重优化方向材料'
    expect(interviewDeliveredArtifactOptions([atom])).toEqual([{evidenceId:'research',sourceScopeId:atom.sourceScopeId,text:outcome}])
    expect(interviewResultEvidenceAtoms(['research'],[atom],outcome+'。')).toEqual([atom])
    for(const invented of [outcome.replace('367','999'),outcome+'，已被采纳并提升转化率',outcome+'；当前尚未上线', '主导问卷、10+家门店调研']) {
      expect(interviewResultEvidenceAtoms(['research'],[atom],invented)).toEqual([])
    }
    expect(interviewResultEvidenceAtoms([],[atom],outcome)).toEqual([])
    const withFuture={...atom,verbatimText:text+'下一阶段预计转化率达到99%。'}
    expect(interviewResultEvidenceAtoms(['research'],[withFuture],outcome)).toEqual([withFuture])
    expect(interviewResultEvidenceAtoms(['research'],[withFuture],outcome+'，转化率达到99%')).toEqual([])
    expect(interviewDeliveredArtifactOptions([{...atom,verbatimText:'开展问卷、门店调研与访谈。'}])).toEqual([])
    for(const unsafe of [{...atom,status:'excluded' as const},{...atom,riskFlags:['uncertain' as const]},
      {...atom,qualifiers:['仅计划']},{...atom,verbatimText:'计划形成研究报告'}, {...atom,verbatimText:'尚未完成研究报告'},
      {...atom,verbatimText:'如果回收问卷则形成研究报告'}, {...atom,verbatimText:'建议准备形成分析材料'}]) {
      expect(interviewDeliveredArtifactOptions([unsafe])).toEqual([])
    }
  })
  test('a literal measured outcome survives an action primary label without admitting an invented result', () => {
    const f=fixture(), text='扩展目标分配与消息提醒。2025.12目标下发及时率达到90.7%（2025.05基线为79.2%）。'
    const atom:EvidenceAtom={...f.left,evidenceId:'mixed-action',claimType:'action',status:'source_supported',riskFlags:[],qualifiers:[],
      verbatimText:text,normalizedClaim:text,numericAtoms:[{raw:'90.7%',valueText:'90.7',unit:'%',qualifier:null,period:null,ownerScope:'target-project'}]}
    const result='2025.12目标下发及时率达到90.7%（2025.05基线为79.2%）。'
    expect(interviewResultEvidenceAtoms(['mixed-action'],[atom],result)).toEqual([atom])
    expect(interviewResultEvidenceAtoms(['mixed-action'],[atom],result.replace('90.7%','99%'))).toEqual([])
    expect(interviewResultEvidenceAtoms([],[atom],result)).toEqual([])
    expect(interviewResultEvidenceAtoms(['mixed-action'],[atom],'扩展目标分配与消息提醒。')).toEqual([])
    for(const unsafe of [{...atom,status:'excluded' as const},{...atom,riskFlags:['uncertain' as const]},
      {...atom,riskFlags:['future_or_planned' as const]},{...atom,qualifiers:['待核实']}]) {
      expect(interviewResultEvidenceAtoms(['mixed-action'],[unsafe],result)).toEqual([])
    }
    const future={...atom,verbatimText:'预计目标下发及时率达到90.7%。'}
    expect(interviewResultEvidenceAtoms(['mixed-action'],[future],future.verbatimText)).toEqual([])
  })
  test('binds the real B0089–B0090 comparison while retaining both original units and qualifications', () => {
    const f = fixture(), before = structuredClone(f.atoms)
    expect(findInterviewResultContinuations(f.atoms)).toEqual([{ resultEvidenceId: 'result', previousEvidenceId: 'result', tailEvidenceId: 'tail' }])
    expect(interviewResultEvidenceAtoms(['result', 'tail'], f.atoms)).toEqual(f.atoms)
    expect(interviewResultEvidenceAtoms(['result', 'tail'], [...f.atoms].reverse())).toEqual(f.atoms)
    expect(f.atoms).toEqual(before)
    expect(f.right.verbatimText).toContain('68. 4%')
    expect(f.right.qualifiers).toContain('使用时必须保留月份口径')
  })

  test('an uncited or orphan tail cannot authorize its numbers', () => {
    const f = fixture()
    expect(interviewResultEvidenceAtoms(['result'], f.atoms)).toEqual([f.left])
    expect(interviewResultEvidenceAtoms(['tail'], f.atoms)).toEqual([])
  })

  test('retains a completed prototype result with its planned-next-step boundary', () => {
    const f = fixture()
    const text = '方案与原型已完成，待立项；不可写成已经上线。'
    const plannedResult: EvidenceAtom = { ...f.left, claimType: 'deliverable', verbatimText: text, normalizedClaim: text,
      sourceSpan: { start: 0, end: text.length }, riskFlags: ['future_or_planned'], qualifiers: ['待立项', '不可写成已经上线'] }
    expect(interviewResultEvidenceAtoms(['result'], [plannedResult])).toEqual([plannedResult])
    expect(interviewResultEvidenceAtoms(['result'], [plannedResult])[0]).toBe(plannedResult)
    expect(interviewResultEvidenceAtoms(['result'], [{ ...plannedResult, status: 'excluded' }])).toEqual([])
  })

  test.each(['cross_scope', 'cross_document', 'nonconsecutive_block', 'span_gap', 'overlap', 'bad_span', 'complete_prefix', 'not_numeric', 'excluded', 'unsafe', 'future', 'identity', 'duplicate_id', 'duplicate_block'] as const)('rejects unproven continuation: %s', mutation => {
    const f = fixture()
    if (mutation === 'cross_scope') f.right.sourceScopeId = 'other-project'
    if (mutation === 'cross_document') f.right.sourceDocumentHash = 'another-document'
    if (mutation === 'nonconsecutive_block') f.right.sourceBlockId = 'B0091'
    if (mutation === 'span_gap') { f.right.sourceSpan.start += 1; f.right.sourceSpan.end += 1 }
    if (mutation === 'overlap') { f.right.sourceSpan.start -= 3; f.right.sourceSpan.end -= 3 }
    if (mutation === 'bad_span') f.right.sourceSpan.end += 1
    if (mutation === 'complete_prefix') { f.left.verbatimText += '68.4%。'; f.left.sourceSpan.end += 6; f.right.sourceSpan.start += 6; f.right.sourceSpan.end += 6 }
    if (mutation === 'not_numeric') { f.right.verbatimText = '另一个项目已上线。'; f.right.sourceSpan.end = f.right.sourceSpan.start + f.right.verbatimText.length }
    if (mutation === 'excluded') f.right.status = 'excluded'
    if (mutation === 'unsafe') f.right.riskFlags = ['conflicting']
    if (mutation === 'future') f.right.riskFlags = ['future_or_planned']
    if (mutation === 'identity') f.right.claimType = 'identity'
    if (mutation === 'duplicate_id') f.atoms.push({ ...f.right, sourceBlockId: 'B0200' })
    if (mutation === 'duplicate_block') f.atoms.push({ ...f.right, evidenceId: 'other-tail' })
    expect(findInterviewResultContinuations(f.atoms)).toEqual([])
    expect(interviewResultEvidenceAtoms(['result', 'tail'], f.atoms).some(atom => atom.evidenceId === 'tail')).toBe(false)
  })

  test('multiple result tails require every predecessor citation', () => {
    const f = fixture()
    f.right.verbatimText = '68.4%，另一组由45.5%提升至'
    f.right.sourceSpan.end = f.right.sourceSpan.start + f.right.verbatimText.length
    const end: EvidenceAtom = { ...f.right, evidenceId: 'end', sourceBlockId: 'B0091', verbatimText: '79.2%，月份口径待确认。',
      sourceSpan: { start: f.right.sourceSpan.end + 1, end: f.right.sourceSpan.end + 1 + '79.2%，月份口径待确认。'.length } }
    f.atoms.push(end)
    expect(interviewResultEvidenceAtoms(['result', 'tail', 'end'], f.atoms).map(atom => atom.evidenceId)).toEqual(['result', 'tail', 'end'])
    expect(interviewResultEvidenceAtoms(['result', 'end'], f.atoms).map(atom => atom.evidenceId)).toEqual(['result'])
  })

  test.each([
    '员工目标下发及时率由43.3%提升至（原文截断）。', '转化率由3%提升至。', '转化率由3%提升至',
    '效率提高到，反馈待确认。', '累计结果达到未知。', '结果文本被截断。',
    '员工及时率待补数值。', '员工及时率待补充数字。',
    '员工及时率由43.3%至', '员工及时率由43.3%至。', '员工及时率43.3%→',
    '员工及时率43.3% -> 未提供。',
  ])('rejects an incomplete known result: %s', text => {
    expect(hasIncompleteInterviewResult(text)).toBe(true)
  })

  test.each([
    '员工目标下发及时率由43.3%提升至68.4%，需保留月份口径。',
    '审核由40分钟降至近乎零人工干预。', '达到预期，仍需复核。', '材料不足，knownResult应为null。',
    '员工及时率由43.3%至68.4%。', '员工及时率43.3%→68.4%，仍需核对月份口径。',
    '材料于3月至5月完成整理，项目仍待立项。',
  ])('accepts complete results without stripping qualifications: %s', text => {
    expect(hasIncompleteInterviewResult(text)).toBe(false)
  })
})
