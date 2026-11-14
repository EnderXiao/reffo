import { describe, expect, test } from 'bun:test'
import { canonicalizeSourceDocument } from '@/v5/canonical-source'
import { preserveSourceTimeline } from '@/v5/source-structure'
import { calculateExperienceDuration } from '@/v5/experience-duration'
import { buildJobRequirementBundle, validateJobExtractionCandidate } from '@/v5/evidence'
import { deriveRequirementSemantics } from '@/v5/targeting/requirement-semantics'
import { buildRequirementJudgments } from '@/v5/targeting/judgments'
import { inspectFitRequirementScope, inspectFitRequirementScopeDetails, prepareJobFitScopeRepair, projectLegacyMatch, sourcePracticeStrengths, validateJobFitMap } from '@/v5/targeting/fit'
import { calculateV5MatchScore } from '@/v5/match-score'
import { actionWritingFocus, buildEditorialActionLedger } from '@/v5/writing/action-ledger'
import { alignRequirementAnalysisStrengths, toMatchAnalysis } from '@/v5/main/compatibility'
import { createJobFixture, createMatchFixture, createResumeFixture } from './fixtures'
import { createTargetingFixture } from './targeting-fixtures'
import type { JobExtractionCandidate, ResumeEvidenceBundle } from '@/v5/types'
import {canonicalMatchAnalysisSchema,v5MatchAnalysisSchema} from '@/v5/schemas'

test('requirement-specific fit gates cannot import industry, ownership or specialty constraints from context', () => {
  const f=createTargetingFixture(), original=f.fit.links[0]!
  const target={...f.targets[0]!,kind:'requirement' as const,sourceQuote:'具有较强的用户研究和数据分析能力。'}
  const financial={...original,difference:'未提供互联网金融用户研究与金融指标分析案例。'}
  expect(inspectFitRequirementScope(financial,target)).toContain('JOB_FIT_FOREIGN_DOMAIN_GATE')
  expect(inspectFitRequirementScope(financial,{...target,sourceQuote:'具有互联网金融用户研究经验。'})).toEqual([])
  const ownership={...original,difference:'未说明独立负责从0到1产品建设。'}
  expect(inspectFitRequirementScope(ownership,{...target,sourceQuote:'具有从0到1产品建设经验。'})).toContain('JOB_FIT_INVENTED_OWNERSHIP_GATE')
  expect(inspectFitRequirementScope(ownership,{...target,sourceQuote:'具有独立负责从0到1产品建设经验。'})).toEqual([])
  const ai={...original,difference:'有AI应用设计实践。',roleBoundary:'未说明模型训练或评估参与。'}
  expect(inspectFitRequirementScope(ai,{...target,sourceQuote:'了解AI应用或具有AI产品设计经验。'})).toContain('JOB_FIT_INVENTED_SPECIALTY_GATE')
  expect(inspectFitRequirementScope(ai,{...target,sourceQuote:'具有模型训练与评估经验。'})).toEqual([])
})

test('scoped fit repair preserves unaffected links and rejects responses outside the requested scope', () => {
  const f=createTargetingFixture(), target=f.targets[0]!, selected=f.fit.links.find(link=>link.targetId===target.id)!
  const repair=prepareJobFitScopeRepair(f.fit,f.targets,[{issueId:'i',code:'JOB_FIT_FOREIGN_DOMAIN_GATE',severity:'error',outputPath:target.id,
    claimId:null,evidenceIds:[],requirementIds:[],message:'scope',expectedConstraint:'per source scope',replacementText:null}])!
  expect(repair.targets).toHaveLength(1)
  const changed={...selected,difference:'真实资料未说明这一项的具体结论。'}
  const merged=repair.merge({...f.fit,links:[changed],narratives:[]})
  expect(merged.links.filter(link=>link.targetId!==target.id)).toEqual(f.fit.links.filter(link=>link.targetId!==target.id))
  expect(merged.links.find(link=>link.targetId===target.id)?.difference).toBe(changed.difference)
  expect(()=>repair.merge(f.fit)).toThrow('JOB_FIT_SCOPED_REPAIR_TARGET_MISMATCH')
})

test('scope gates distinguish a protected role boundary from an invented specialty deficit', () => {
  const f=createTargetingFixture(), original=f.fit.links[0]!
  const target={...f.targets[0]!,kind:'requirement' as const,sourceQuote:'了解AI应用或具有AI产品设计经验。'}
  const base={...original,difference:'已有AI应用功能设计实践。',roleBoundary:''}
  for(const roleBoundary of ['仅参与产品功能设计，未涉及模型训练或评估。', '模型训练或评估未涉及。', '非模型训练或评估职责。',
    '仅参与产品设计，不承担模型训练或评估职责。', '仅参与产品设计，未涉及模型训练；需补充具体产品职责。',
    '仅参与产品设计，未涉及模型评估，需补充相关产品职责。', '需补充具体产品职责，未涉及模型训练。']) {
    expect(inspectFitRequirementScope({...base,roleBoundary},target)).toEqual([])
  }
  for(const difference of ['本项不要求具备模型训练或评估经验。', '模型训练或评估不是本项要求。', '非本项要求的模型训练或评估不应作为差距。', '不作为模型训练或评估门槛。']) {
    expect(inspectFitRequirementScope({...base,difference},target)).toEqual([])
  }
  for(const field of [{difference:'未提供模型训练或评估材料。'},
    {roleBoundary:'未说明模型训练或评估参与。'}, {roleBoundary:'未涉及模型评估，需补充这一差距。'},
    {roleBoundary:'不承担模型训练或评估职责，需补充相关证据。'}, {roleBoundary:'未涉及模型评估，仍需补充。'},
    {roleBoundary:'未涉及模型评估，需补充评估经验。'}, {roleBoundary:'未涉及模型评估，仍有缺口。'},
    {unprovenAspects:[{text:'模型评估',reason:'未提供模型评估证据。'}]},
    {expressionAngle:'需补充模型训练或评估细节。'}]) {
    expect(inspectFitRequirementScope({...base,...field},target)).toContain('JOB_FIT_INVENTED_SPECIALTY_GATE')
  }
})

test('each model specialty requires its own source criterion without treating product review as model evaluation', () => {
  const f=createTargetingFixture(), original=f.fit.links[0]!
  const base={...original,similarity:'',expressionAngle:'',roleBoundary:''}
  const target={...f.targets[0]!,kind:'requirement' as const}
  for(const [sourceQuote,difference] of [
    ['具有模型训练经验。','未说明模型评估经验。'],
    ['具有模型评估经验。','未说明模型训练经验。'],
    ['具有模型训练经验。','未说明模型微调经验。'],
    ['具有模型微调经验。','未说明模型评估经验。'],
    ['具有AI模型应用方案评估经验。','未说明大语言模型训练或微调经验。'],
    ['具有AI模型应用方案评估经验。','未说明模型效果评估经验。'],
  ]) expect(inspectFitRequirementScope({...base,difference}, {...target,sourceQuote}))
    .toContain('JOB_FIT_INVENTED_SPECIALTY_GATE')
  for(const [sourceQuote,difference] of [
    ['具有模型训练经验。','未说明模型训练经验。'],
    ['具有模型训练与评估经验。','未说明模型评估经验。'],
    ['具有模型训练、微调与评估经验。','未说明模型评估经验。'],
    ['具有模型的离线质量评估经验。','未说明模型效果评估经验。'],
    ['具有AI产品设计经验。','未说明AI模型应用方案评估经验。'],
    ['具有AI产品设计经验。','未说明模型应用方案的评估经验。'],
  ]) expect(inspectFitRequirementScope({...base,difference}, {...target,sourceQuote}))
    .not.toContain('JOB_FIT_INVENTED_SPECIALTY_GATE')
})

test('rendered role boundaries do not become new specialty gaps but evidence absence still does', () => {
  const f=createTargetingFixture(), original=f.fit.links[0]!
  const target={...f.targets[0]!,kind:'requirement' as const,sourceQuote:'了解AI应用或具有AI产品设计经验。'}
  const base={...original,difference:'已有AI产品功能设计实践。',similarity:'',expressionAngle:'',roleBoundary:''}
  for (const roleBoundary of ['为AI产品能力设计，未写模型训练或评估。',
    'AI辅导为产品能力设计，未写模型训练或评估。', '仅写产品应用设计，没有写模型训练。',
    '仅参与产品设计，不写成模型训练或模型评估。', '仅参与产品设计，模型训练未写。',
    '为产品能力设计，未写模型训练；需补充具体产品职责。', '不写成模型训练经历。', '不声称模型训练能力。']) {
    expect(inspectFitRequirementScope({...base,roleBoundary},target)).toEqual([])
  }
  for (const roleBoundary of ['未写模型训练或评估。', '为AI产品能力设计，材料未写模型训练。',
    '为AI产品能力设计，简历中未写模型训练。', '为AI产品能力设计，未写明模型训练经验。',
    '为AI产品能力设计，未写模型训练能力。', '为AI产品能力设计，未写模型训练；需补充这一差距。',
    '为AI产品能力设计，未写模型训练，仍需补充。', '为AI产品能力设计，未写模型训练，但评估证据需补充。']) {
    expect(inspectFitRequirementScope({...base,roleBoundary},target)).toContain('JOB_FIT_INVENTED_SPECIALTY_GATE')
  }
  for (const field of [{difference:'为AI产品能力设计，未写模型训练。'},
    {unprovenAspects:[{text:'模型训练',reason:'为AI产品能力设计，未写。'}]},
    {roleBoundary:'为AI产品能力设计，未写模型训练。',expressionAngle:'需补充模型训练经历。'},
    {roleBoundary:'为AI产品能力设计，未写模型训练。',difference:'模型训练证据尚未提供。'}]) {
    expect(inspectFitRequirementScope({...base,...field},target)).toContain('JOB_FIT_INVENTED_SPECIALTY_GATE')
  }
  expect(inspectFitRequirementScope({...base,difference:'模型训练证据尚未提供。'},
    {...target,sourceQuote:'具有模型训练经验。'})).not.toContain('JOB_FIT_INVENTED_SPECIALTY_GATE')
})

test('scope diagnostics identify the exact field, clause and source criterion without changing target repair paths', () => {
  const f=createTargetingFixture(), target={...f.targets[0]!,kind:'requirement' as const,sourceQuote:'了解AI应用或具有AI产品设计经验。'}
  const link={...f.fit.links[0]!,targetId:target.id,difference:'已有AI设计实践。',similarity:'',expressionAngle:'',
    roleBoundary:'为AI产品能力设计，未写模型训练。',
    unprovenAspects:[{text:'模型评估能力',reason:'未提供模型评估证据。'}]}
  const findings=inspectFitRequirementScopeDetails(link,target)
  expect(findings).toEqual([
    {code:'JOB_FIT_INVENTED_SPECIALTY_GATE',field:'unprovenAspects[0].text',clause:'模型评估能力',mention:'模型评估',criterion:'模型评估',sourceQuote:target.sourceQuote},
    {code:'JOB_FIT_INVENTED_SPECIALTY_GATE',field:'unprovenAspects[0].reason',clause:'未提供模型评估证据',mention:'模型评估',criterion:'模型评估',sourceQuote:target.sourceQuote},
  ])
  const issues=validateJobFitMap({...f.fit,links:[link],narratives:[]},[target],f.resume).issues
    .filter(issue=>issue.code==='JOB_FIT_INVENTED_SPECIALTY_GATE')
  expect(issues).toHaveLength(1)
  expect(issues[0]!.outputPath).toBe(target.id)
  expect(issues[0]!.message).toContain('unprovenAspects[0].reason「未提供模型评估证据」')
  expect(issues[0]!.message).toContain(target.sourceQuote)
  expect(issues[0]!.message).not.toContain('roleBoundary「')
})

test('scope disclaimers cannot conceal a separate new threshold or combine unrelated fields', () => {
  const f=createTargetingFixture(), original=f.fit.links[0]!
  const target={...f.targets[0]!,kind:'requirement' as const,sourceQuote:'了解AI应用或具有AI产品设计经验。'}
  const base={...original,difference:'已有AI产品设计实践。',roleBoundary:''}
  expect(inspectFitRequirementScope({...base,difference:'不要求模型训练，但仍需补充模型评估证据。'},target)).toContain('JOB_FIT_INVENTED_SPECIALTY_GATE')
  expect(inspectFitRequirementScope({...base,difference:'不要求金融行业经验；模型评估材料未提供。'},target)).toContain('JOB_FIT_INVENTED_SPECIALTY_GATE')
  expect(inspectFitRequirementScope({...base,difference:'未说明AI模型。',roleBoundary:'参与评估产品设计方案。'},target)).toEqual([])
  expect(inspectFitRequirementScope({...base,difference:'模型评估材料未提供。'}, {...target,sourceQuote:'了解AI应用，不要求模型评估经验。'})).toContain('JOB_FIT_INVENTED_SPECIALTY_GATE')
  expect(inspectFitRequirementScope({...base,difference:'不将金融行业作为门槛。'},target)).toEqual([])
  expect(inspectFitRequirementScope({...base,difference:'不设为金融行业门槛。'},target)).toEqual([])
})

test('scope repair supplies concrete specialty and domain exclusions instead of replaying rejected gaps', () => {
  const f=createTargetingFixture(), target={...f.targets[0]!,kind:'requirement' as const,sourceQuote:'了解AI应用或具有AI产品设计经验。'}
  const issue=(code:string)=>({issueId:code,code,severity:'error' as const,outputPath:target.id,claimId:null,evidenceIds:[],requirementIds:[],message:'scope',expectedConstraint:'per source scope',replacementText:null})
  const repair=prepareJobFitScopeRepair(f.fit,[target],[issue('JOB_FIT_INVENTED_SPECIALTY_GATE'),issue('JOB_FIT_FOREIGN_DOMAIN_GATE')])!
  expect(repair.isolatedRequirements).toBe(true)
  const output=repair.currentOutput as {sourceBoundaries:Array<{excludedCriteria:string[]}>}
  expect(output.sourceBoundaries[0]!.excludedCriteria).toHaveLength(2)
  expect(output.sourceBoundaries[0]!.excludedCriteria.join('')).toContain('模型训练、模型微调、模型评估')
  expect(output.sourceBoundaries[0]!.excludedCriteria.join('')).toContain('公司行业或其他目标')
  const trainingTarget={...target,sourceQuote:'具有模型训练经验。'}
  const trainingRepair=prepareJobFitScopeRepair(f.fit,[trainingTarget],[issue('JOB_FIT_INVENTED_SPECIALTY_GATE')])!
  const trainingBoundaries=trainingRepair.currentOutput as {sourceBoundaries:Array<{excludedCriteria:string[]}>}
  expect(trainingBoundaries.sourceBoundaries[0]!.excludedCriteria.join('')).toContain('此原文未要求模型微调、模型评估')
  expect(trainingBoundaries.sourceBoundaries[0]!.excludedCriteria.join('')).not.toContain('此原文未要求模型训练')
})

test('a scope exclusion cannot exempt a separately coordinated missing specialty', () => {
  const f=createTargetingFixture(), original=f.fit.links[0]!
  const target={...f.targets[0]!,kind:'requirement' as const,sourceQuote:'了解AI应用或具有AI产品设计经验。'}
  const base={...original,difference:'已有AI产品设计实践。',roleBoundary:''}
  for (const difference of ['无需金融经验以及模型评估材料未提供。', '不要求模型训练也未说明模型评估。',
    '不需要金融经验而模型评估尚需补充。', '未说明模型评估且金融不是门槛。',
    '不要求模型训练和模型评估且需补充模型微调材料。']) {
    expect(inspectFitRequirementScope({...base,difference},target)).toContain('JOB_FIT_INVENTED_SPECIALTY_GATE')
  }
  for (const difference of ['不要求模型训练和模型评估。', '不要求模型训练以及模型评估经验。',
    '模型训练和模型评估均不是本项门槛。']) {
    expect(inspectFitRequirementScope({...base,difference},target)).toEqual([])
  }
})

test('every public judgment reason preserves source ownership and basic proficiency thresholds', () => {
  const f=createTargetingFixture(), original=f.fit.links[0]!
  const target={...f.targets[0]!,kind:'requirement' as const,sourceQuote:'有从0到1产品建设经验。'}
  const fields=[{difference:'独立主导0到1范围材料未说明。'},
    {difference:'不能证明独立主导0到1建设。'},
    {difference:'已有参与0到1实践。',unprovenAspects:[{text:'0到1责任范围',reason:'独立主导范围尚未提供。'}]},
    {difference:'已有参与0到1实践。',roleBoundary:'未说明独立牵头范围。'},
    {difference:'已有参与0到1实践。',expressionAngle:'需补充独立交付0到1的范围。'}]
  for(const field of fields)expect(inspectFitRequirementScope({...original,...field},target)).toContain('JOB_FIT_INVENTED_OWNERSHIP_GATE')
  expect(inspectFitRequirementScope({...original,difference:'已有0到1参与实践。',roleBoundary:'参与不自动升级为独立负责。'},target)).toEqual([])
  const basic={...target,sourceQuote:'具备基础的数据分析能力'}
  expect(inspectFitRequirementScope({...original,difference:'有具体分析实践。',unprovenAspects:[{text:'分析方法的系统化程度',reason:'未说明系统化方法。'}]},basic)).toContain('JOB_FIT_INVENTED_PROFICIENCY_GATE')
  expect(inspectFitRequirementScope({...original,difference:'系统化方法未说明。'},{...basic,sourceQuote:'具备系统化的数据分析方法'})).toEqual([])
  expect(inspectFitRequirementScope({...original,difference:'参与经验已有，完整建设过程未说明。'},target)).toContain('JOB_FIT_INVENTED_SCOPE_GATE')
})

test('safe partial source practice becomes a bounded strength without certifying the whole requirement', () => {
 const f=createTargetingFixture(),link=f.fit.links.find(item=>item.targetId===f.job.requirementAtoms[0]!.requirementId)!
 f.fit.narratives=[]
 Object.assign(link,{status:'weak_signal',supportedAspects:[{text:f.business.verbatimText,evidenceIds:[f.business.evidenceId]}],
  unprovenAspects:[{text:'目标领域完整范围未证明。',reason:'材料有限。'}]})
 const source=sourcePracticeStrengths(f.fit,f.targets,f.resume)
 expect(source).toHaveLength(1)
 expect(source[0]!.statement).toContain('可迁移实践：')
 const match=projectLegacyMatch(f.fit,f.targets,f.resume,f.job)
 expect(match.strengths.some(strength=>strength.strengthId.startsWith('source_practice_'))).toBe(true)
 expect(match.positioning.statement).toContain(f.business.verbatimText)
 expect(match.judgmentBundle!.items[0]!.status).toBe('transferable_or_partial')
 expect(match.judgmentBundle!.items[0]!.unprovenAspects).not.toHaveLength(0)
 f.business.riskFlags.push('future_or_planned')
 expect(sourcePracticeStrengths(f.fit,f.targets,f.resume)).toEqual([])
})

test('public external condition strengths use exact source semantics with conservative ambiguous matches', () => {
 const f=createTargetingFixture(),source=f.job.requirementAtoms[0]!
 const item={id:'external',text:source.verbatimText,basis:'explicit' as const,strength:'necessary' as const,sourceQuotes:[source.verbatimText],rationale:''}
 const analysis={version:'job-requirement-analysis-v1' as const,portrait:null,tasks:[],outcomes:[],successConditions:[],attributes:[],externalRequirements:[item],unknowns:[],conflicts:[]}
 const semantics={kind:'general_ability' as const,condition:'unclear' as const,requiredOwnership:null,domainConstraint:null,minimumYears:null,preferredRange:null,scoringGroupId:'same'}
 source.semantics=semantics
 for(const condition of ['expected','unclear','preferred','required'] as const){
  source.semantics={...semantics,condition}
  expect(alignRequirementAnalysisStrengths(analysis,f.job)?.externalRequirements[0]?.strength).toBe(condition==='required'?'necessary':condition==='preferred'?'preferred':'unspecified')
 }
 f.job.requirementAtoms.push({...source,requirementId:'same-quote-other',semantics:{...semantics,condition:'preferred'}})
 expect(alignRequirementAnalysisStrengths(analysis,f.job)?.externalRequirements[0]?.strength).toBe('unspecified')
 expect(analysis.externalRequirements[0]?.strength).toBe('necessary')
 const unmatched={...analysis,externalRequirements:[{...item,sourceQuotes:['邻近但不是原文']} ]}
 expect(alignRequirementAnalysisStrengths(unmatched,f.job)?.externalRequirements[0]?.strength).toBe('unspecified')
 f.job.requirementAtoms=f.job.requirementAtoms.slice(0,1);delete source.semantics
 expect(alignRequirementAnalysisStrengths(analysis,f.job)?.externalRequirements[0]?.strength).toBe('necessary')
})

const canonical = (text: string) => canonicalizeSourceDocument(text, 'structure-regression').canonicalDocument
function timelineBundle(text: string, records: Array<{scopeId: string; kind?: 'experience'|'internship'|'other'; organization?: string|null; title?: string|null; start?:string|null; end?:string|null; blocks:number[]}>): ResumeEvidenceBundle {
  const doc = canonical(text), base = createResumeFixture().bundle
  base.evidenceAtoms = records.flatMap(item => item.blocks.map(index => ({...base.evidenceAtoms[0]!, evidenceId:`ev_${item.scopeId}_${index}`,
    sourceBlockId: doc.blocks[index]!.sourceBlockId, sourceScopeId:item.scopeId, verbatimText:doc.blocks[index]!.text,
    normalizedClaim:doc.blocks[index]!.text, claimType:'timeline' as const})))
  base.timeline = records.map(item => ({scopeId:item.scopeId,kind:item.kind??'experience',organization:item.organization??null,title:item.title??null,
    start:item.start??null,end:item.end??null,evidenceIds:base.evidenceAtoms.filter(atom=>atom.sourceScopeId===item.scopeId).map(atom=>atom.evidenceId)}))
  return preserveSourceTimeline(doc,base)
}
function jdCandidate(text: string, quotes: Array<[string, JobExtractionCandidate['requirementCandidates'][number]['category']]>): {document:ReturnType<typeof canonical>;candidate:JobExtractionCandidate} {
  const document=canonical(text), candidate=createJobFixture().candidate
  candidate.basicInfo={title:null,company:null,location:null};candidate.basicInfoSourceBlockIds=[];candidate.unmappedFragments=[]
  candidate.requirementCandidates=quotes.map(([quote,category],index)=>{
    const block=document.blocks.find(block=>block.text.includes(quote))!,start=block.text.indexOf(quote)
    return {requirementLocalId:`r${index}`,sourceBlockId:block.sourceBlockId,blockRelativeSpan:{start,end:start+quote.length},verbatimText:quote,
      normalizedRequirement:quote,category,importance:category==='responsibility'?'core_outcome':'must_have',logicGroupLocalId:null,logicOperator:null,explicitness:'explicit'}
  })
  candidate.basicInfoSourceBlockIds=document.blocks.filter(block=>!quotes.some(([quote])=>block.text.includes(quote))).map(block=>block.sourceBlockId)
  candidate.coverageClaim={mappedSourceBlockIds:document.blocks.map(block=>block.sourceBlockId),unmappedSourceBlockIds:[]}
  return {document,candidate}
}

describe('source structure and requirement semantics v2',()=>{
  test('retains internal phases under employment and section-wide internships without mutating source',()=>{
    const text='## 工作经历\n## 甲集团丨数字化中心\n产品经理 2024.07-至今\n- 营运产品 | 2025.06起：负责规则设计。\n- 会员产品 | 2024.07-2025.06：负责会员管理。\n## 实习经历\n乙汽车丨体验部\n产品助理 2023.01-2023.07\n## 丙集团丨设计中心\n创新设计师 2021.02-2021.08\n## 教育背景'
    const bundle=timelineBundle(text,[{scopeId:'work',blocks:[1,2,3],title:'产品经理'},{scopeId:'phase',blocks:[4],start:'2024.07',end:'2025.06'},
      {scopeId:'intern1',blocks:[6,7],title:'产品助理'},{scopeId:'intern2',blocks:[8,9],title:'创新设计师'}])
    expect(bundle.timeline.find(item=>item.scopeId==='work')!.organization).toBe('甲集团')
    expect(bundle.sourceStructure!.nodes.find(item=>item.scopeId==='phase')).toMatchObject({kind:'internal_phase',parentScopeId:'work',organization:'甲集团'})
    expect(bundle.timeline.filter(item=>item.kind==='internship').map(item=>item.organization)).toEqual(['乙汽车','丙集团'])
    expect(canonical(text).blocks[4]!.text).toContain('2024.07-2025.06')
  })
  test('creates immutable revision mappings when source-supported hierarchy is rebuilt',()=>{
    const fixture=createResumeFixture(), prior=structuredClone(fixture.bundle.sourceStructure!)
    prior.sourceRevision='source_previous';prior.nodes[0]!.sourceBlockIds=['B0002']
    const rebuilt=preserveSourceTimeline(fixture.document,fixture.bundle,{previousStructure:prior})
    expect(rebuilt.sourceStructure!.previousSourceRevision).toBe('source_previous')
    expect(rebuilt.sourceStructure!.scopeMappings!.some(item=>item.currentScopeIds.length>1)).toBe(true)
    expect(prior.sourceRevision).toBe('source_previous')
  })
  test('splits education, years and preferred domain; header range shares one scoring intent',()=>{
    const text='3-5年\n任职要求\n本科以上学历，3年以上互联网产品经理工作经验，有金融科技、金融交易等相关产品经验优先。'
    const fixture=jdCandidate(text,[['3-5年','experience'],['本科以上学历','education'],['3年以上互联网产品经理工作经验','experience'],['有金融科技、金融交易等相关产品经验优先','experience']])
    const atoms=buildJobRequirementBundle(fixture.document,fixture.candidate).requirementAtoms
    expect(atoms.map(atom=>atom.semantics!.condition)).toEqual(['expected','required','required','preferred'])
    expect(atoms[0]!.semantics!.scoringGroupId).toBe(atoms[2]!.semantics!.scoringGroupId)
    expect(atoms[3]!.importance).toBe('nice_to_have')
    expect(atoms[2]!.semantics!.minimumYears).toBe(3)
    expect(atoms[0]!.semantics!.preferredRange).toEqual({minimum:3,maximum:5})
  })
  test('rejects whole-block semantic coverage and JD ownership inflation',()=>{
    const compound='本科以上学历，3年以上产品经理工作经验，有金融产品经验优先。'
    const unsplit=jdCandidate(compound,[[compound,'experience']])
    expect(validateJobExtractionCandidate(unsplit.document,unsplit.candidate).issues.some(item=>item.code==='JD_COMPOSITE_QUALIFICATION_UNSPLIT')).toBe(true)
    const fixture=jdCandidate('有从0到1产品建设经验',[['有从0到1产品建设经验','experience']])
    expect(deriveRequirementSemantics(fixture.document,fixture.candidate.requirementCandidates[0]!).requiredOwnership).toBeNull()
    fixture.candidate.requirementCandidates[0]!.normalizedRequirement='独立主导从0到1产品建设'
    expect(validateJobExtractionCandidate(fixture.document,fixture.candidate).issues.some(item=>item.code==='JD_OWNERSHIP_UPGRADE')).toBe(true)
  })
  test('keeps explicit independent ownership and confines preferred domain to its own atom',()=>{
    const fixture=jdCandidate('岗位职责\n独立完成需求分析和PRD\n加分项\n具备基础的数据分析能力',[['独立完成需求分析和PRD','responsibility'],['具备基础的数据分析能力','skill']])
    const atoms=buildJobRequirementBundle(fixture.document,fixture.candidate).requirementAtoms
    expect(atoms[0]!.semantics!.requiredOwnership).toBe('independent')
    expect(atoms[1]!.semantics).toMatchObject({condition:'preferred',domainConstraint:null})
  })
  test('assigns stable noncolliding IDs to distinct facets with the same exact source span',()=>{
    const fixture=jdCandidate('熟悉方案设计和数据分析',[['熟悉方案设计和数据分析','skill'],['熟悉方案设计和数据分析','skill']])
    fixture.candidate.requirementCandidates[0]!.normalizedRequirement='方案设计'
    fixture.candidate.requirementCandidates[1]!.normalizedRequirement='数据分析'
    const atoms=buildJobRequirementBundle(fixture.document,fixture.candidate).requirementAtoms
    expect(new Set(atoms.map(atom=>atom.requirementId)).size).toBe(2)
    fixture.candidate.requirementCandidates.splice(1,1)
    expect(buildJobRequirementBundle(fixture.document,fixture.candidate).requirementAtoms[0]!.requirementId).toBe(atoms[0]!.requirementId)
  })
})

describe('deterministic duration, canonical judgments and rule-based scoring',()=>{
  test('unions overlapping full-time months, separates internships and does not extend present',()=>{
    const bundle=createResumeFixture().bundle, template=bundle.timeline[0]!
    bundle.timeline=[{...template,scopeId:'a',start:'2024.01',end:'2024.07'},{...template,scopeId:'b',start:'2024.03',end:'2024.09'},
      {...template,scopeId:'i',kind:'internship',start:'2023.01',end:'2023.07'},{...template,scopeId:'open',start:'2024.07',end:'至今'}]
    const unknown=calculateExperienceDuration(bundle)
    expect(unknown.fullTime.months).toBeNull();expect(unknown.fullTime.knownLowerBoundMonths).toBe(8)
    expect(unknown.internship.months).toBe(6)
    expect(calculateExperienceDuration(bundle,{sourceAsOf:'2026-09-14'}).fullTime.months).toBe(32)
    expect(calculateExperienceDuration({...bundle,timeline:[]} as ResumeEvidenceBundle).fullTime.months).toBeNull()
  })
  test('does not use task support as certification for an omitted requirement judgment',()=>{
    const f=createTargetingFixture();f.fit.links=f.fit.links.filter(link=>link.targetId.startsWith('job:'))
    expect(buildRequirementJudgments(f.fit,f.job,f.resume).items.every(item=>item.status==='unproven')).toBe(true)
  })
  test('keeps concrete partial practice, attribution boundary and conservative public booleans',()=>{
    const f=createTargetingFixture(),link=f.fit.links.find(item=>item.targetId===f.job.requirementAtoms[0]!.requirementId)!
    Object.assign(link,{status:'weak_signal',supportedAspects:[{text:'参与团队产品交付。',evidenceIds:[f.business.evidenceId]}],unprovenAspects:[{text:'独立规划范围待核验。',reason:'材料未说明'}]})
    const match=projectLegacyMatch(f.fit,f.targets,f.resume,f.job),judgment=match.judgmentBundle!.items[0]!
    expect(judgment.status).toBe('transferable_or_partial');expect(judgment.roleBoundary).toContain('协同')
    const score=calculateV5MatchScore({resume:f.resume,job:f.job,match})
    const publicResult=toMatchAnalysis({resumeEvidenceBundle:f.resume,jobRequirementBundle:f.job,matchAnalysis:match,matchScore:score})
    expect(Object.values(publicResult.hard_requirements_match).every(value=>value===null)).toBe(true)
    expect(score).toMatchObject({formulaVersion:'match-score-v3',metadata:{calibrationStatus:'rules_based'}})
    expect(typeof score.score).toBe('number')
  })
  test('requires contrary source facts rather than a negative model rationale',()=>{
    const f=createTargetingFixture(),requirement=f.job.requirementAtoms[0]!,link=f.fit.links.find(item=>item.targetId===requirement.requirementId)!
    requirement.verbatimText='有金融交易产品经验';link.status='explicit_gap';link.difference='没有金融交易经验。'
    expect(buildRequirementJudgments(f.fit,f.job,f.resume).items[0]!.status).toBe('unproven')
    f.business.verbatimText='本人没有金融交易产品经验。'
    expect(buildRequirementJudgments(f.fit,f.job,f.resume).items[0]!.status).toBe('not_met')
    f.business.verbatimText='没有金融交易经验材料，但有产品交付实践。'
    expect(buildRequirementJudgments(f.fit,f.job,f.resume).items[0]!.status).toBe('unproven')
  })
  test('detects a contradiction between cited release follow-up and a blanket missing-follow-up claim',()=>{
    const f=createTargetingFixture();f.business.verbatimText='通过监控发现异常，组织日志分析、问题复现和修复发版。'
    f.fit.links[0]!.difference='材料尚无上线后跟进证据。'
    expect(validateJobFitMap(f.fit,f.targets,f.resume).issues.some(item=>item.code==='JOB_FIT_SOURCE_NEGATION_CONFLICT')).toBe(true)
    for (const difference of ['未提供与风控、数据团队协作及金融业务上线后表现跟进的案例。', '金融业务上线后表现跟进未提供相关材料。', '材料未说明金融业务场景的发布后跟进。', '尚未说明上线后业务指标跟踪。']) {
      f.fit.links[0]!.difference = difference
      expect(validateJobFitMap(f.fit,f.targets,f.resume).issues.some(item=>item.code==='JOB_FIT_SOURCE_NEGATION_CONFLICT')).toBe(false)
    }
    f.fit.links[0]!.difference = '金融场景经验尚未提供；尚无上线后跟进证据。'
    expect(validateJobFitMap(f.fit,f.targets,f.resume).issues.some(item=>item.code==='JOB_FIT_SOURCE_NEGATION_CONFLICT')).toBe(true)
  })
  test('retains filtered narrative reasons and recovers only source-supported aspects',()=>{
    const f=createTargetingFixture();f.fit.narratives=[]
    f.fit.links[0]!.supportedAspects=[{text:'参与团队产品迭代，交付3个功能。',evidenceIds:[f.business.evidenceId]}]
    const checked=validateJobFitMap(f.fit,f.targets,f.resume)
    expect(checked.value!.narratives).toHaveLength(1)
    expect(checked.value!.narrativeDiagnostics!.recovery).toBe('recovered_from_supported_aspects')
  })
  test('action-based selection excludes skill-only strengths and always preserves a practice boundary',()=>{
    const f=createMatchFixture(), ledger=buildEditorialActionLedger(f)
    const focuses=actionWritingFocus(undefined,ledger,f.resume)!
    expect(focuses.length).toBeGreaterThan(0)
    expect(focuses.every(focus=>focus.limitation.trim().length>0)).toBe(true)
    expect(focuses.every(focus=>!focus.evidenceIds.includes(f.skill.evidenceId))).toBe(true)
    expect(focuses.some(focus=>focus.evidenceIds.includes(f.deliverable.evidenceId))).toBe(true)
  })
  test('retains more than legacy prose quotas through the canonical cache JSON roundtrip',()=>{
    const fixture=createTargetingFixture()
    const match=projectLegacyMatch(fixture.fit,fixture.targets,fixture.resume,fixture.job)
    const gap=match.gaps[0]!
    expect(gap).toBeDefined()
    match.gaps=Array.from({length:12},(_,index)=>({...gap,gapId:`gap:${index}`}))
    const strength=match.strengths[0]??{strengthId:'s',requirementIds:[fixture.job.requirementAtoms[0]!.requirementId],evidenceIds:[fixture.business.evidenceId],statement:'参与产品交付。'}
    match.strengths=Array.from({length:8},(_,index)=>({...strength,strengthId:`strength:${index}`}))
    const raw=JSON.parse(JSON.stringify(match))
    expect(v5MatchAnalysisSchema.safeParse(raw).success).toBe(false)
    const parsed=canonicalMatchAnalysisSchema.parse(raw)
    expect(parsed.gaps).toHaveLength(12)
    expect(parsed.strengths).toHaveLength(8)
    expect(canonicalMatchAnalysisSchema.safeParse({...raw,arbitraryClaim:'不可信新字段'}).success).toBe(false)
    expect(canonicalMatchAnalysisSchema.safeParse({...raw,gaps:[{...gap,priority:'invented'}]}).success).toBe(false)
  })
  test('deduplicates scoring groups and retains legacy v1 without linear conversion',()=>{
    const old=createMatchFixture(),oldScore=calculateV5MatchScore(old)
    expect(oldScore.formulaVersion).toBe('match-score-v1');expect(typeof oldScore.score).toBe('number')
    const f=createTargetingFixture();f.job.requirementAtoms.push({...f.job.requirementAtoms[0]!,requirementId:'req_duplicate'})
    f.fit.links.push({...f.fit.links.find(item=>item.targetId===f.job.requirementAtoms[0]!.requirementId)!,targetId:'req_duplicate'})
    const match=projectLegacyMatch(f.fit,[...f.targets,{...f.targets.find(item=>item.id===f.job.requirementAtoms[0]!.requirementId)!,id:'req_duplicate'}],f.resume,f.job)
    const score=calculateV5MatchScore({resume:f.resume,job:f.job,match})
    expect(score.metadata!.deduplicatedRequirementCount).toBe(1);expect(typeof score.score).toBe('number')
    const unknown=calculateV5MatchScore({resume:f.resume,job:f.job,match:{...match,judgmentBundle:{...match.judgmentBundle!,items:match.judgmentBundle!.items.map(item=>({...item,status:'unproven'}))}}})
    expect(unknown.score).toBeNull();expect(unknown.confidence).toBe('low')
  })
})
