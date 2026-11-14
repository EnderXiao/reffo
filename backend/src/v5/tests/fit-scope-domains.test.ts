import {describe, expect, test} from 'bun:test'
import type {JobFitMap} from '@/v5/targeting/contracts'
import type {JobTarget} from '@/v5/targeting/profile'
import {inspectFitRequirementScope, inspectFitRequirementScopeDetails} from '@/v5/targeting/fit'
import {createTargetingFixture} from './targeting-fixtures'

// These fixtures isolate JD scope boundaries; they do not certify job matching,
// medical or engineering expertise, or the quality of an end-to-end model run.
function boundaryFixture(sourceQuote: string, fields: Partial<JobFitMap['links'][number]> = {}) {
  const fixture=createTargetingFixture()
  const target: JobTarget={...fixture.targets[0]!,kind:'requirement',sourceQuote,text:sourceQuote}
  const link: JobFitMap['links'][number]={...fixture.fit.links[0]!,targetId:target.id,
    similarity:'',difference:'',expressionAngle:'',roleBoundary:'',supportedAspects:[],unprovenAspects:[],...fields}
  return {target,link}
}

describe('model engineering requirements preserve explicit specialist criteria',()=>{
  for (const specialty of ['模型训练','模型微调','模型评估']) {
    test(`explicit ${specialty} remains a valid unproven criterion`,()=>{
      const {target,link}=boundaryFixture(`算法工程师须具有${specialty}经验。`,{
        difference:`当前材料尚未提供${specialty}实践。`,
        unprovenAspects:[{text:`${specialty}经验`,reason:`需要核对${specialty}实践的具体证据。`}],
      })
      expect(inspectFitRequirementScope(link,target)).not.toContain('JOB_FIT_INVENTED_SPECIALTY_GATE')
      expect(inspectFitRequirementScopeDetails(link,target)).toEqual([])
    })
  }

  test('a role explicitly requiring all three specialties does not lose them during boundary checks',()=>{
    const {target,link}=boundaryFixture('大模型工程师需要模型训练、模型微调与模型评估经验。',{
      difference:'尚未提供模型训练与模型微调经历；模型评估实践也需补充证据。',
      unprovenAspects:[{text:'模型训练与模型微调',reason:'当前记录只有服务接入。'},
        {text:'模型评估',reason:'未说明模型评估结果。'}],
    })
    expect(inspectFitRequirementScope(link,target)).toEqual([])
  })

  test('one explicit specialty cannot authorize a different missing specialty',()=>{
    for (const [requested,added] of [['模型训练','模型微调'],['模型微调','模型评估'],['模型评估','模型训练']]) {
      const {target,link}=boundaryFixture(`研发岗位要求${requested}实践。`,{difference:`还需补充${added}证明。`})
      expect(inspectFitRequirementScope(link,target)).toContain('JOB_FIT_INVENTED_SPECIALTY_GATE')
    }
  })
})

const domainCases=[
  {role:'医疗服务设计',quote:'能够梳理就诊流程并开展用户需求研究。',
    supported:'参与梳理预约、候诊与检查流程。',boundary:'仅参与院内就诊流程设计，未涉及模型训练。'},
  {role:'零售营运',quote:'能够分析门店库存与补货需求，提出业务改进方案。',
    supported:'分析门店缺货记录并参与调整补货规则。',boundary:'仅参与门店补货规则设计，未承担模型评估职责。'},
  {role:'后端开发',quote:'具备接口设计、缓存优化及服务故障定位经验。',
    supported:'参与接口改造与缓存失效问题定位。',boundary:'仅承担接口与缓存方案设计，未写模型训练。'},
  {role:'数据分析',quote:'能够核对指标口径，使用SQL完成报表与业务分析。',
    supported:'使用SQL核对订单口径并维护经营报表。',boundary:'仅负责报表与指标口径设计，未涉及模型微调。'},
] as const

for (const domain of domainCases) describe(`${domain.role} boundaries`,()=>{
  test('generic practice does not acquire an unrelated financial requirement',()=>{
    const {target,link}=boundaryFixture(domain.quote,{similarity:domain.supported,
      difference:'现有材料仅覆盖已列明的具体实践范围。'})
    expect(inspectFitRequirementScope(link,target)).toEqual([])
  })

  test('an invented financial deficit is still rejected',()=>{
    const {target,link}=boundaryFixture(domain.quote,{similarity:domain.supported,
      unprovenAspects:[{text:'金融风控业务经验',reason:'尚未提供银行风控实践。'}]})
    expect(inspectFitRequirementScope(link,target)).toContain('JOB_FIT_FOREIGN_DOMAIN_GATE')
    const findings=inspectFitRequirementScopeDetails(link,target)
    expect(findings.some(item=>item.field==='unprovenAspects[0].reason' && item.sourceQuote===domain.quote)).toBe(true)
  })

  test('participation cannot become a missing independent ownership requirement',()=>{
    const {target,link}=boundaryFixture(domain.quote,{similarity:domain.supported,
      difference:'材料未证明独立负责完整交付。'})
    expect(inspectFitRequirementScope(link,target)).toContain('JOB_FIT_INVENTED_OWNERSHIP_GATE')
    expect(inspectFitRequirementScope(link,{...target,sourceQuote:`独立负责相应工作，${domain.quote}`}))
      .not.toContain('JOB_FIT_INVENTED_OWNERSHIP_GATE')
  })

  test('a source role boundary does not create a specialist deficit',()=>{
    const {target,link}=boundaryFixture(domain.quote,{similarity:domain.supported,roleBoundary:domain.boundary})
    expect(inspectFitRequirementScope(link,target)).toEqual([])
    expect(inspectFitRequirementScope({...link,expressionAngle:'需补充模型训练的实践证据。'},target))
      .toContain('JOB_FIT_INVENTED_SPECIALTY_GATE')
  })

  test('a separate request to fill the specialist gap cannot hide behind a role boundary',()=>{
    const {target,link}=boundaryFixture(domain.quote,{similarity:domain.supported,
      roleBoundary:`${domain.boundary}仍需补充这一专项差距。`})
    expect(inspectFitRequirementScope(link,target)).toContain('JOB_FIT_INVENTED_SPECIALTY_GATE')
  })
})

test('financial criteria explicitly present in the source remain assessable',()=>{
  const {target,link}=boundaryFixture('支付数据分析师需要金融交易数据分析经验。',{
    difference:'目前未提供金融交易数据分析实践。',
    unprovenAspects:[{text:'金融交易数据分析',reason:'需核对金融业务经验。'}],
  })
  expect(inspectFitRequirementScope(link,target)).not.toContain('JOB_FIT_FOREIGN_DOMAIN_GATE')
})

test('a source exclusion does not authorize adding that specialty back as a gap',()=>{
  const {target,link}=boundaryFixture('服务端工程师负责业务接口开发，不要求模型训练。',{
    difference:'还需补充模型训练经历。',
  })
  expect(inspectFitRequirementScope(link,target)).toContain('JOB_FIT_INVENTED_SPECIALTY_GATE')
})
