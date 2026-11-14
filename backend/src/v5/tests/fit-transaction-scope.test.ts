import {describe, expect, test} from 'bun:test'
import {inspectFitRequirementScope, prepareJobFitScopeRepair, validateJobFitMap} from '@/v5/targeting/fit'
import {writingIssue} from '@/v5/writing/facts'
import {createTargetingFixture} from './targeting-fixtures'

describe('transaction practice does not authorize a financial-industry requirement', () => {
  function fixture(sourceQuote: string, difference: string) {
    const source = createTargetingFixture()
    const target = {...source.targets[0]!, kind: 'requirement' as const, sourceQuote, text: sourceQuote}
    const link = {...source.fit.links[0]!, targetId: target.id, difference,
      similarity: '', expressionAngle: '', roleBoundary: '', supportedAspects: [], unprovenAspects: []}
    return {...source, target, link}
  }

  for (const sourceQuote of ['有电商交易流程设计经验。', '熟悉二手商品交易平台业务。', '有交易系统开发经验。']) {
    test(`${sourceQuote} preserves transaction scope without adding finance`, () => {
      const f = fixture(sourceQuote, '当前材料未提供金融行业交易实践。')
      expect(inspectFitRequirementScope(f.link, f.target)).toContain('JOB_FIT_FOREIGN_DOMAIN_GATE')
      expect(inspectFitRequirementScope({...f.link, difference: '交易流程的具体设计范围未说明。'}, f.target)).toEqual([])
      expect(inspectFitRequirementScope({...f.link, difference: '尚未提供银行交易系统经验。'}, f.target))
        .toContain('JOB_FIT_FOREIGN_DOMAIN_GATE')
    })
  }

  test('explicit financial transactions and specialties remain genuine criteria', () => {
    const f = fixture('需要金融交易产品设计经验。', '当前材料未说明金融交易产品实践。')
    expect(inspectFitRequirementScope(f.link, f.target)).toEqual([])
    expect(inspectFitRequirementScope({...f.link, difference: '尚未说明银行风控业务实践。'}, f.target))
      .toContain('JOB_FIT_FOREIGN_DOMAIN_GATE')
    expect(inspectFitRequirementScope({...f.link, difference: '银行风控经验尚未说明。'},
      {...f.target, sourceQuote: '需要银行风控产品经验。'})).toEqual([])
  })

  test('scoped repair preserves the real transaction criterion and unaffected judgments', () => {
    const f = fixture('有电商交易流程设计经验。', '尚未证明金融行业交易产品经验。')
    const other = {...f.targets[1]!, id: 'job:task:unaffected'}
    const otherLink = {...f.fit.links[1]!, targetId: other.id}
    const fit = {...f.fit, links: [f.link, otherLink], narratives: []}
    const repair = prepareJobFitScopeRepair(fit, [f.target, other], [
      writingIssue('JOB_FIT_FOREIGN_DOMAIN_GATE', f.target.id, [], '附加金融行业门槛'),
    ])!
    const scope = JSON.stringify(repair.currentOutput)
    expect(scope).toContain('原文明示的行业条件应保留')
    expect(scope).toContain('未要求金融行业')
    expect(scope).not.toContain('未要求金融行业、交易专项')
    const corrected = {...f.link, status: 'unknown' as const, difference: '当前材料未说明交易流程设计的具体范围。', evidenceIds: []}
    const merged = repair.merge({...fit, links: [corrected]})
    const checked = validateJobFitMap(merged, [f.target, other], f.resume)
    expect(checked.issues.filter(issue => issue.code === 'JOB_FIT_FOREIGN_DOMAIN_GATE')).toEqual([])
    expect(merged.links[1]).toEqual(otherLink)
    expect(fit.links[0]!.difference).toContain('金融行业')
  })
})
