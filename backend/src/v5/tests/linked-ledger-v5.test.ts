import {expect, test} from 'bun:test'
import {createV5ResultFixture} from './fixtures'
import {createTargetingFixture} from './targeting-fixtures'
import {v5FixtureEntry} from './entry-skeleton-fixtures'
import {buildWritingPlan} from '@/v5/writing/plan'
import {buildEntryWritingPlan, compileEntryWriting, entryWritingPayload, ENTRY_WRITING_POLICY, entryWritingV6OutputSchema} from '@/v5/writing/entries'
import {buildDetailSeeds} from '@/v5/writing/detail-ledger'
import {buildEditorialActionLedger, bindEditorialActionsToEntries, buildCompiledActionReview, resolveGeneratedDetailActions} from '@/v5/writing/action-ledger'
import {validateActionPlan} from '@/shared/resume-actions'
import {collectGaps} from '@/shared/resume-completion'
function fixture() {
 const r=createV5ResultFixture(), t=createTargetingFixture()
 const input={resume:r.resumeEvidenceBundle,job:r.jobRequirementBundle,match:r.matchAnalysis,plan:r.resumePlan,policy:r.generationPolicy,
  targeting:{profile:t.candidate.jobSuccessProfile,targets:t.targets,fit:t.fit},editorialPolicy:'document-editorial-v1' as const}
 const base=buildWritingPlan(input), plan=buildEntryWritingPlan({...input,base}), ledger=buildEditorialActionLedger({resume:input.resume,match:input.match})
 const resolved=bindEditorialActionsToEntries(ledger,plan)
 for(const entry of plan.entries) {entry.detailSeeds=buildDetailSeeds(entry,input.resume.evidenceAtoms);entry.editorialActions=resolved.actions.filter(a=>resolved.bindings.some(b=>b.actionId===a.actionId&&b.destination?.entryId===entry.entryId))}
 const payload=entryWritingPayload(plan)
 const output={contractVersion:ENTRY_WRITING_POLICY,entries:plan.entries.map(entry=>{const fact=entry.facts.find(f=>entry.coreEvidenceIds.includes(f.evidenceId))??entry.facts[0];return v5FixtureEntry({entryId:entry.entryId,paragraphs:[{role:'detail',text:fact.text,evidenceIds:[fact.evidenceId]}]},payload.entries.find(e=>e.entryId===entry.entryId)!)})}
 const compile=()=>compileEntryWriting({output,entryPlan:plan,resume:input.resume,policy:input.policy})
 return {input,plan,ledger,resolved,output,compile}
}
test('v5 fully documented practice can validly produce zero experience blanks with five semantic answers',()=>{
 const f=fixture(), parsed=entryWritingV6OutputSchema.parse(f.output), compiled=f.compile()
 expect(parsed.entries.every(e=>e.coverage.every(c=>c.answer.trim()))).toBe(true)
 expect(compiled.completionDocument.schemaVersion).toBe('resume-completion-v4')
 expect(collectGaps(compiled.completionDocument)).toHaveLength(0)
 expect(validateActionPlan(f.ledger,f.resolved)).toEqual([])
})
test.each([
 ['responsibility','本人具体职责尚未说明。','not_applicable'],
 ['project','项目名称材料未提供。','not_applicable'],
 ['problem','围绕既有研究展开，具体业务痛点材料未记录。','not_applicable'],
 ['solution','当前材料未说明具体方案。','not_applicable'],
 ['result','实际产出材料未记录。','deliverable'],
 ['result','结果材料未记录。','business_outcome'],
 ['result','已有研究活动，结果仍待核对。','unknown'],
] as const)('known coverage rejects an explicit undocumented self-report: %s / %s',(element,answer,resultKind)=>{
 const f=fixture(), item=f.output.entries.find(entry=>f.plan.entries.find(brief=>brief.entryId===entry.entryId)?.slot.kind==='business_bullet')!.coverage.find(item=>item.element===element)!
 Object.assign(item,{answer,resultKind})
 expect(()=>f.compile()).toThrow()
 try{f.compile()}catch(error){expect((error as {issues:Array<{code:string}>}).issues.some(issue=>issue.code==='WRITER_COVERAGE_INVALID')).toBe(true)}
 Object.assign(item,{status:'ambiguous'})
 expect(()=>f.compile()).not.toThrow()
})
test('known deliverables and known problems keep a separate, explicitly unrecorded outcome boundary',()=>{
 const f=fixture(), coverage=f.output.entries.find(entry=>f.plan.entries.find(brief=>brief.entryId===entry.entryId)?.slot.kind==='business_bullet')!.coverage
 Object.assign(coverage.find(item=>item.element==='problem')!,{answer:'已记录稳定性异常及修复问题；业务收益未记录。'})
 Object.assign(coverage.find(item=>item.element==='result')!,{answer:'已形成研究报告；业务收益材料未记录。',resultKind:'deliverable'})
 expect(()=>f.compile()).not.toThrow()
 Object.assign(coverage.find(item=>item.element==='problem')!,{answer:'已记录稳定性异常；不能断言业务痛点材料未记录。'})
 expect(()=>f.compile()).not.toThrow()
})
test('known server detail candidates cannot disappear via empty assessments',()=>{
 const f=fixture(), entry=f.plan.entries.find(e=>e.slot.kind==='business_bullet')!
 entry.detailSeeds=[{detailId:'mandatory',subjectKind:'experience_detail',subject:'已知项目',detailKind:'research_finding',element:'result',anchorEvidenceIds:[entry.facts[0].evidenceId],contextCompleteness:'complete',rationale:'核对发现',requiredDisposition:true}]
 try {f.compile(); throw new Error('expected rejection')} catch(error) {expect((error as {issues: Array<{code: string}>}).issues.some(i=>i.code==='WRITER_DETAIL_SEED_UNRESOLVED')).toBe(true)}
})
test('research inside an ordinary project receives the same source-owned detail assessment seed',()=>{
 const f=fixture(), entry=f.plan.entries.find(e=>e.slot.kind==='business_bullet')!
 entry.section='project'
 const atom=f.input.resume.evidenceAtoms.find(a=>entry.facts.some(fact=>fact.evidenceId===a.evidenceId))!
 atom.claimType='action';atom.verbatimText='主导问卷、门店访谈与行为分析，回收367份答卷，形成研究报告。'
 const seeds=buildDetailSeeds(entry,f.input.resume.evidenceAtoms)
 expect(seeds.some(seed=>seed.detailKind==='research_finding'&&seed.anchorEvidenceIds.includes(atom.evidenceId))).toBe(true)
 expect(seeds.find(seed=>seed.detailKind==='research_finding')?.rationale).toContain('有答案直接使用')
})
test('invalid self-reported receipts are quarantined without discarding fact-checked body or certifying adoption',()=>{
 const f=fixture(), entry=f.output.entries[0]
 Object.assign(entry,{actionReceipts:[{actionId:'foreign',unitIds:['invented'],evidenceIds:[],detailIds:[],coveredAspectIds:['all'],explanation:'自报完成'}]})
 const compiled=f.compile()
 expect(compiled.actionReceipts).toEqual([])
 expect(compiled.entryAudits[0].rejectedActionReceipts).toMatchObject([{actionId:'foreign',reasonCodes:['unknown_action','unlinked_unit']}])
 expect(compiled.writingIssues.some(i=>i.code==='WRITER_ACTION_RECEIPT_REJECTED'&&i.severity==='warning')).toBe(true)
 expect(compiled.artifact.markdown).not.toContain('自报完成')
 const reviewed=buildCompiledActionReview({base:f.ledger,resolved:f.resolved,document:compiled.completionDocument,receipts:compiled.actionReceipts,references:compiled.entryParagraphReferences})
 expect(reviewed.actionReview.outcomes.some(outcome=>outcome.state==='adopted')).toBe(false)
})
test('same evidence coincidence does not certify an expression strategy',()=>{
 const f=fixture(), compiled=f.compile()
 const reviewed=buildCompiledActionReview({base:f.ledger,resolved:f.resolved,document:compiled.completionDocument,receipts:[],references:compiled.entryParagraphReferences})
 expect(reviewed.actionReview.outcomes.filter(o=>o.state==='adopted')).toHaveLength(0)
 expect(f.input.match.gaps).toEqual(createV5ResultFixture().matchAnalysis.gaps)
})

test('education actions bind to their own sourced education entry instead of a cross-scope summary',()=>{
 const f=fixture(), source=f.plan.entries.find(entry=>entry.slot.kind==='business_bullet')!
 const evidenceId=source.facts[0]!.evidenceId, action=f.ledger.actions.find(item=>item.evidenceIds.includes(evidenceId))!
 const education={...structuredClone(source),entryId:'education',section:'education' as const,slot:{...source.slot,kind:'ancillary' as const,sectionKey:'education' as const}}
 const summary={...structuredClone(source),entryId:'summary',scopeId:null,section:'summary' as const,slot:{...source.slot,kind:'summary' as const,sectionKey:'summary' as const}}
 const resolved=bindEditorialActionsToEntries(f.ledger,{...f.plan,entries:[summary,education]})
 expect(resolved.bindings.find(item=>item.actionId===action.actionId)?.destination?.entryId).toBe('education')
 const noEducation=bindEditorialActionsToEntries(f.ledger,{...f.plan,entries:[summary]})
 expect(noEducation.bindings.find(item=>item.actionId===action.actionId)?.selection).toBe('omitted_with_reason')
 const foreignEducation=bindEditorialActionsToEntries(f.ledger,{...f.plan,entries:[{...education,scopeId:'foreign'}]})
 expect(foreignEducation.bindings.find(item=>item.actionId===action.actionId)?.destination).toBeUndefined()
 const headingOnly=bindEditorialActionsToEntries(f.ledger,{...f.plan,entries:[{...education,facts:[],projectIdentity:{text:'来源学历标题',evidenceIds:[evidenceId]}}]})
 expect(headingOnly.bindings.find(item=>item.actionId===action.actionId)?.destination?.entryId).toBe('education')
})

test('source-bound education headings become reviewable anchors without self-certifying adoption',()=>{
 const f=fixture(), compiled=f.compile(), entry=f.plan.entries.find(item=>item.slot.kind==='business_bullet')!
 const action=f.ledger.actions.find(item=>item.evidenceIds.includes(entry.facts[0]!.evidenceId))!
 const resolved={...f.resolved,bindings:f.resolved.bindings.map(binding=>binding.actionId===action.actionId
  ? {...binding,selection:'selected' as const,destination:{entryId:'education',unitIds:[]}} : binding)}
 const document=structuredClone(compiled.completionDocument)
 document.blocks.push({blockId:'source-degree',kind:'heading3',prefix:'### ',outputPath:`scope_heading.education.${entry.scopeId}`,
  segments:[{kind:'text',segmentId:'source-degree:text',markdown:'来源学校｜工业设计｜本科',origin:'generated'}]},
 {blockId:'foreign-degree',kind:'heading3',prefix:'### ',outputPath:'scope_heading.education.foreign',
  segments:[{kind:'text',segmentId:'foreign-degree:text',markdown:'其他学校｜博士',origin:'generated'}]})
 const review=buildCompiledActionReview({base:f.ledger,resolved,document,receipts:[],references:[]})
 const outcome=review.actionReview.outcomes.find(item=>item.actionId===action.actionId)!
 expect(outcome.state).toBe('pending_review')
 expect(outcome.coveredAspectIds).toEqual([])
 expect(outcome.anchors.map(anchor=>anchor.blockId)).toEqual(['source-degree'])
 expect(compiled.renderedBlocks.filter(block=>/^### /u.test(block.raw)).every(block=>block.outputPath?.startsWith('scope_heading.'))).toBe(true)
})

test('a multi-case action reviews all evidence-bound units while keeping its primary destination',()=>{
 const f=fixture(), compiled=f.compile(), source=f.plan.entries.find(entry=>entry.slot.kind==='business_bullet')!
 const action=f.resolved.actions.find(item=>item.evidenceIds.includes(source.facts[0]!.evidenceId))!
 const extra={...structuredClone(source),entryId:'second-case',scopeId:'second-scope',facts:source.facts.map(fact=>({...fact,evidenceId:'second-evidence'}))}
 const resolved=structuredClone(f.resolved)
 const target=resolved.actions.find(item=>item.actionId===action.actionId)!
 target.sourceScopeIds.push('second-scope');target.evidenceIds.push('second-evidence')
 const document=structuredClone(compiled.completionDocument)
 document.blocks.push({blockId:'second-case-block',kind:'bullet',prefix:'- ',unitId:'second-case:unit:0',entryId:extra.entryId,
  outputPath:'project.second-scope.bullets[0]',segments:[{kind:'text',segmentId:'second-case-text',markdown:'第二真实案例的已知设计行动。',origin:'generated',unitId:'second-case:unit:0'}]},
 {blockId:'summary-copy',kind:'paragraph',prefix:'',unitId:'summary-copy:unit:0',entryId:'summary-copy',segments:[{kind:'text',segmentId:'summary-copy-text',markdown:'摘要复述不能代替实际案例。',origin:'generated',unitId:'summary-copy:unit:0'}]})
 const plan={...f.plan,entries:[...f.plan.entries,extra,{...extra,entryId:'summary-copy',section:'summary' as const}]}
 const updated=resolveGeneratedDetailActions({base:f.ledger,resolved,document,entryAudits:[],entryPlan:plan})
 const binding=updated.bindings.find(item=>item.actionId===action.actionId)!
 expect(binding.destination?.entryId).toBe(resolved.bindings.find(item=>item.actionId===action.actionId)?.destination?.entryId)
 expect(binding.destination?.unitIds).toContain('second-case:unit:0')
 expect(binding.destination?.unitIds).not.toContain('summary-copy:unit:0')
 const review=buildCompiledActionReview({base:f.ledger,resolved:updated,document,receipts:[],references:[]})
 const outcome=review.actionReview.outcomes.find(item=>item.actionId===action.actionId)!
 expect(outcome.anchors.some(anchor=>anchor.blockId==='second-case-block')).toBe(true)
 expect(outcome.state).toBe('pending_review')
})
