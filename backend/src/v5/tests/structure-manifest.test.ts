import {expect, test} from 'bun:test'
import {buildResumeStructureBasis} from '@/v5/writing/structure-manifest'
import {canonicalizeSourceDocument} from '@/v5/canonical-source'
import {buildStructureChanges, buildChangeManifest, freezeActionPlan, freezeResolvedActionPlan, reconcileEditorialActions} from '@/shared/resume-actions'
import {createPlainCompletionDocument, serializeDraft} from '@/shared/resume-completion'
import {createV5ResultFixture} from './fixtures'

function fixture() {
  const result = createV5ResultFixture()
  const source = canonicalizeSourceDocument('## 工作经历\n### 甲公司 产品经理\n- 梳理需求。\n## 实习经历\n### 乙公司 产品助理 实习\n- 参与原型设计。\n## 项目经历\n### 独立研究项目\n- 完成研究。', 'structure-test').canonicalDocument
  const nodes = [
    {scopeId: 'work', kind: 'employment' as const, label: '甲公司｜产品经理', sourceOrder: 1, parentScopeId: null, beforeQuote: source.blocks[1]!.text, blockIds: ['work-body'], entryIds: ['entry-work'], protectedValues: ['甲公司', '产品经理']},
    {scopeId: 'intern', kind: 'internship' as const, label: '乙公司｜产品助理', sourceOrder: 4, parentScopeId: null, beforeQuote: source.blocks[4]!.text, blockIds: ['intern-body'], entryIds: ['entry-intern'], protectedValues: ['乙公司', '产品助理', '实习']},
    {scopeId: 'project', kind: 'project' as const, label: '独立研究项目', sourceOrder: 7, parentScopeId: null, beforeQuote: source.blocks[7]!.text, blockIds: [], entryIds: ['entry-project'], protectedValues: []},
  ]
  const document = createPlainCompletionDocument('## 实习经历\n### 乙公司 产品助理\n- 参与原型设计。\n## 工作经历\n### 甲公司 产品经理\n- 梳理需求。\n## 个人优势\n- 基于真实实践归纳。', {documentId: 'structure-doc'})
  Object.assign(document.blocks[2]!, {blockId: 'intern-body', entryId: 'entry-intern'})
  Object.assign(document.blocks[5]!, {blockId: 'work-body', entryId: 'entry-work'})
  const basis = {version: 'resume-structure-basis-v1' as const, sourceRevision: source.sha256, nodes, sourceSectionTitles: ['工作经历', '实习经历', '项目经历']}
  return {result, source, document, basis}
}

test('structural manifest distinguishes removed scopes, reordered careers, new sections and preserved internship boundaries', () => {
  const f = fixture(), changes = buildStructureChanges(f.basis, f.document)
  expect(changes.find(change => change.kind === 'removed')?.sourceScopeIds).toEqual(['project'])
  expect(changes.find(change => change.kind === 'removed')?.beforeQuotes).toEqual(['### 独立研究项目'])
  expect(changes.some(change => change.kind === 'reordered' && change.description.includes('乙公司'))).toBe(true)
  expect(changes.find(change => change.kind === 'added')?.description).toContain('个人优势')
  expect(changes.find(change => change.kind === 'identity_boundary' && change.sourceScopeIds.includes('intern'))?.validation).toBe('source_bound')
  expect(changes.every(change => change.beforeQuotes.every(quote => f.source.blocks.some(block => block.text === quote)))).toBe(true)
})

test('a known section alias is not reported as newly added while a truly new section remains visible', () => {
  const f = fixture()
  f.basis.sourceSectionTitles = ['代表项目', '教育经历', '工作经验']
  const document = createPlainCompletionDocument('## 项目经历\n- 已有项目。\n## 教育背景\n- 已有教育。\n## 工作经历\n- 已有任职。\n## 语言能力\n- 已有语言材料。', {documentId: 'section-alias'})
  const additions = buildStructureChanges({...f.basis, nodes: []}, document).filter(change => change.kind === 'added')
  expect(additions).toHaveLength(1)
  expect(additions[0].description).toContain('语言能力')
})

test('a prior unrelated internship heading cannot conceal a changed employment boundary', () => {
  const f = fixture()
  const section = f.document.blocks[0]!.segments[0]!
  if (section.kind === 'text') section.markdown = '项目经历'
  const changes = buildStructureChanges(f.basis, f.document)
  expect(changes.find(change => change.kind === 'identity_boundary' && change.sourceScopeIds.includes('intern'))).toMatchObject({validation: 'needs_review'})
  expect(changes.find(change => change.kind === 'identity_boundary' && change.sourceScopeIds.includes('intern'))?.description).toContain('实习')
})

test('structure changes recompute after an edit and survive action review without invented before quotes', () => {
  const f = fixture(), plan = freezeActionPlan({planId: 'plan', sourceRevision: 'source', judgmentRevision: 'judgment', actions: []})
  const resolved = freezeResolvedActionPlan({resolvedPlanId: 'resolved', revision: 0, basePlanId: plan.planId, baseDigest: plan.baseDigest, actions: [], bindings: []})
  const review = reconcileEditorialActions({resolvedPlan: resolved, document: f.document})
  const initial = buildChangeManifest(review, resolved, {structureBasis: f.basis, document: f.document})
  const edited = {...f.document, revision: 1, blocks: f.document.blocks.filter(block => block.blockId !== 'work-body')}
  const current = buildChangeManifest({...review, revision: 1}, resolved, {previous: initial, document: edited})
  expect(current.structureChanges?.filter(change => change.kind === 'removed').flatMap(change => change.sourceScopeIds)).toContain('work')
  expect(buildChangeManifest({...review, revision: 1}, resolved, {previous: current}).structureChanges).toEqual(current.structureChanges)
  expect(current.revision).toBe(1)
})

test('server structural basis joins exact source headers to compiled output ownership only', () => {
  const f = fixture(), atom = f.result.resumeEvidenceBundle.evidenceAtoms[0]!
  atom.sourceScopeId = 'work'; atom.sourceBlockId = f.source.blocks[1]!.sourceBlockId
  f.result.resumeEvidenceBundle.sourceStructure = {version: 'source-structure-v2', sourceRevision: 'source-revision', nodes: [{
    scopeId: 'work', kind: 'employment', parentScopeId: null, organization: '甲公司', title: '产品经理', sourceBlockIds: [atom.sourceBlockId], phases: [],
  }], issues: []}
  f.result.artifact.claims = [{claimId: 'claim', outputPath: 'experience.work.bullets[0]', outputText: '梳理需求。', evidenceIds: [atom.evidenceId], transformation: 'verbatim', attributionLevel: 'contributed'}]
  f.document.blocks[5]!.outputPath = 'experience.work.bullets[0]'
  const basis = buildResumeStructureBasis({source: f.source, resume: f.result.resumeEvidenceBundle, artifact: f.result.artifact, document: f.document})
  expect(basis.nodes[0]).toMatchObject({scopeId: 'work', beforeQuote: '### 甲公司 产品经理', blockIds: ['work-body']})
  expect(serializeDraft(f.document)).toContain('梳理需求。')
})


test('a summary referencing a project does not pretend its separate project entry was retained', () => {
  const f = fixture(), atom = f.result.resumeEvidenceBundle.evidenceAtoms[0]!
  atom.sourceScopeId = 'project'; atom.sourceBlockId = f.source.blocks[7]!.sourceBlockId
  f.result.resumeEvidenceBundle.sourceStructure = {version: 'source-structure-v2', sourceRevision: 'source-revision', nodes: [{
    scopeId: 'project', kind: 'project', parentScopeId: null, organization: null, title: '独立研究项目', sourceBlockIds: [atom.sourceBlockId], phases: [],
  }], issues: []}
  f.result.artifact.claims = [{claimId: 'summary', outputPath: 'summary[0]', outputText: '具有研究经验', evidenceIds: [atom.evidenceId], transformation: 'safe_paraphrase', attributionLevel: 'contributed'}]
  f.document.blocks[7]!.outputPath = 'summary[0]'
  const basis = buildResumeStructureBasis({source: f.source, resume: f.result.resumeEvidenceBundle, artifact: f.result.artifact, document: f.document})
  expect(basis.nodes[0]!.blockIds).toEqual([])
  expect(buildStructureChanges(basis, f.document).find(change => change.kind === 'removed')?.sourceScopeIds).toEqual(['project'])
})

test('a fixed scoped timeline row remains retained without a model business entry', () => {
  const f = fixture(), atom = f.result.resumeEvidenceBundle.evidenceAtoms[0]!
  atom.sourceScopeId = 'work'; atom.sourceBlockId = f.source.blocks[1]!.sourceBlockId
  f.result.resumeEvidenceBundle.sourceStructure = {version: 'source-structure-v2', sourceRevision: 'source-revision', nodes: [{
    scopeId: 'work', kind: 'employment', parentScopeId: null, organization: '甲公司', title: '产品经理', sourceBlockIds: [atom.sourceBlockId], phases: [],
  }], issues: []}
  f.result.artifact.claims = [{claimId: 'timeline', outputPath: 'timeline.work', outputText: '甲公司｜产品经理', evidenceIds: [atom.evidenceId], transformation: 'verbatim', attributionLevel: 'contributed'}]
  f.document.blocks[5]!.outputPath = 'timeline.work'
  const fixed = f.document.blocks[5]!.segments[0]!
  if (fixed.kind === 'text') fixed.markdown = '甲公司｜产品经理'
  const basis = buildResumeStructureBasis({source: f.source, resume: f.result.resumeEvidenceBundle, artifact: f.result.artifact, document: f.document})
  expect(basis.nodes[0]!.blockIds).toEqual(['work-body'])
  const changes = buildStructureChanges(basis, f.document)
  expect(changes.some(change => change.kind === 'removed')).toBe(false)
  expect(changes.find(change => change.kind === 'identity_boundary')?.validation).toBe('source_bound')
})


test('an internal phase is regrouped only when its own source evidence appears in its parent business entry', () => {
  const f = fixture(), atom = f.result.resumeEvidenceBundle.evidenceAtoms[0]!
  atom.sourceScopeId = 'work'; atom.sourceBlockId = f.source.blocks[2]!.sourceBlockId
  f.result.resumeEvidenceBundle.sourceStructure = {version: 'source-structure-v2', sourceRevision: 'source-revision', nodes: [
    {scopeId: 'work', kind: 'employment', parentScopeId: null, organization: '甲公司', title: '产品经理', sourceBlockIds: [f.source.blocks[1]!.sourceBlockId, atom.sourceBlockId], phases: []},
    {scopeId: 'phase', kind: 'internal_phase', parentScopeId: 'work', organization: '甲公司', title: '需求梳理阶段', sourceBlockIds: [atom.sourceBlockId], phases: []},
  ], issues: []}
  f.result.artifact.claims = [{claimId: 'phase-claim', outputPath: 'experience.work.bullets[0]', outputText: '梳理需求。', evidenceIds: [atom.evidenceId], transformation: 'verbatim', attributionLevel: 'contributed'}]
  f.document.blocks[5]!.outputPath = 'experience.work.bullets[0]'
  const basis = buildResumeStructureBasis({source: f.source, resume: f.result.resumeEvidenceBundle, artifact: f.result.artifact, document: f.document})
  const changes = buildStructureChanges(basis, f.document)
  expect(changes.find(change => change.kind === 'regrouped')?.sourceScopeIds).toEqual(['phase', 'work'])
  expect(changes.some(change => change.kind === 'removed')).toBe(false)
})
