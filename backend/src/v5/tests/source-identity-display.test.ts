import {expect, test} from 'bun:test'
import {createV5ResultFixture} from './fixtures'
import {canonicalizeSourceDocument} from '@/v5/canonical-source'
import {preserveSourceTimeline} from '@/v5/source-structure'
import {formatTimelineHeading} from '@/v5/composition/timeline-display'
import {explicitGraduationMonth, educationFields, educationDetailPriority, isEducationIdentityOnly} from '@/v5/writing/education'
import {sourceBusinessDisplayText} from '@/v5/composition/source-display'
import {toResumeAnalysis} from '@/v5/main/compatibility'
import {renderValidatedCompositionArtifact} from '@/v5/composition/compiler'
import {buildCompositionBlueprint} from '@/v5/composition/blueprint'

function fixture() {
  const r = createV5ResultFixture()
  const source = canonicalizeSourceDocument('## 实习经历\n示例汽车丨用户服务\n产品助理 2023.01-2023.07\n## 教育背景\n示例大学 | 服务系统设计 | 理学硕士2021-2024（2024.12毕业）\n均分28.1/30，前15%，获得校奖学金。', 'source-identity').canonicalDocument
  const template = r.resumeEvidenceBundle.evidenceAtoms[0]!
  const atoms = [
    {...template, evidenceId: 'intern', sourceScopeId: 'intern', sourceBlockId: source.blocks[2]!.sourceBlockId, claimType: 'timeline' as const, verbatimText: source.blocks[2]!.text, normalizedClaim: source.blocks[2]!.text, status: 'source_supported' as const, riskFlags: []},
    {...template, evidenceId: 'school', sourceScopeId: 'school', sourceBlockId: source.blocks[4]!.sourceBlockId, claimType: 'education' as const, verbatimText: source.blocks[4]!.text, normalizedClaim: source.blocks[4]!.text, status: 'source_supported' as const, riskFlags: []},
    {...template, evidenceId: 'grade', sourceScopeId: 'school', sourceBlockId: source.blocks[5]!.sourceBlockId, claimType: 'award' as const, verbatimText: source.blocks[5]!.text, normalizedClaim: source.blocks[5]!.text, status: 'source_supported' as const, riskFlags: []},
  ]
  r.resumeEvidenceBundle.evidenceAtoms = atoms
  r.resumeEvidenceBundle.timeline = [
    {scopeId: 'intern', kind: 'experience', organization: null, title: '产品助理', start: '2023.01', end: '2023.07', evidenceIds: ['intern']},
    {scopeId: 'school', kind: 'education', organization: '示例大学', title: '服务系统设计 | 理学硕士', start: '2021', end: '2024', evidenceIds: ['school', 'grade']},
  ]
  r.resumeEvidenceBundle = preserveSourceTimeline(source, r.resumeEvidenceBundle)
  return {r, source, atoms}
}

test('source internships remain explicit in rendered headings and public source analysis', () => {
  const {r} = fixture(), scope = r.resumeEvidenceBundle.timeline[0]!
  expect(scope.kind).toBe('internship')
  expect(formatTimelineHeading(scope)).toBe('示例汽车｜产品助理（实习）｜2023.01 - 2023.07')
  expect(toResumeAnalysis(r).structured_resume.experience[0]!.position).toBe('产品助理（实习）')
  expect(formatTimelineHeading({...scope, kind: 'experience'})).not.toContain('实习')
  expect(formatTimelineHeading({...scope, title: '产品助理（实习）'}).match(/实习/g)).toHaveLength(1)
})

test('same-school explicit graduation month refines end year and splits known major and degree', () => {
  const {r, atoms} = fixture(), scope = r.resumeEvidenceBundle.timeline[1]!
  expect(scope.end).toBe('2024.12')
  expect(formatTimelineHeading(scope)).toContain('2021 - 2024.12')
  const education = toResumeAnalysis(r).structured_resume.education[0]!
  expect(education).toMatchObject({major: '服务系统设计', degree: '理学硕士', time_range: '2021 - 2024.12'})
  expect(education.achievements).toEqual([atoms[2]!.verbatimText])
  expect(educationFields('服务设计')).toEqual({major: '', degree: '服务设计'})
  expect(explicitGraduationMonth([{...atoms[1]!, verbatimText: '2024.12预计毕业'}], '2024')).toBeUndefined()
  expect(explicitGraduationMonth([{...atoms[1]!, verbatimText: '预计2024.12毕业'}], '2024')).toBeUndefined()
  expect(explicitGraduationMonth(atoms.slice(1), '2023')).toBeUndefined()
  expect(explicitGraduationMonth([{...atoms[1]!, verbatimText: '2024.06毕业；2024.12毕业'}], '2024')).toBeUndefined()
})

test('education adds academic distinction rather than repeating a heading with the same degree and dates', () => {
  const {r, atoms} = fixture(), scope = r.resumeEvidenceBundle.timeline[1]!
  expect(isEducationIdentityOnly(atoms[1]!, scope)).toBe(true)
  expect(isEducationIdentityOnly(atoms[2]!, scope)).toBe(false)
  expect(isEducationIdentityOnly({...atoms[1]!, verbatimText: '示例大学 | 服务系统设计 | 理学硕士2021-2025'}, scope)).toBe(false)
  expect(isEducationIdentityOnly({...atoms[1]!, verbatimText: '示例大学 | 服务系统设计 | 理学硕士2021-2024（2024.06毕业）'}, scope)).toBe(false)
  expect(educationDetailPriority(atoms[2]!, scope)).toBeGreaterThan(educationDetailPriority(atoms[1]!, scope))
})

test('school-scoped awards retain exact school attribution in a separate honors section', () => {
  const {r, atoms} = fixture()
  const plan = {...r.resumePlan, stableCoreEvidenceIds: ['grade'], customizedEvidenceIds: [], evidencePillars: [],
    scopePlans: [], featuredSkillEvidenceIds: [], safeKeywordMappings: []}
  const policy = {...r.generationPolicy, sectionOrder: [...r.generationPolicy.sectionOrder, 'awards']}
  const blueprint = buildCompositionBlueprint({resume: r.resumeEvidenceBundle, plan, policy})
  const slot = blueprint.slots.find(item => item.sectionKey === 'awards')!
  expect(slot).toBeDefined()
  const result = renderValidatedCompositionArtifact({resume: r.resumeEvidenceBundle, plan, policy, blueprint,
    composition: {contractVersion: 'p06-composition-v1', blocks: [{slotId: slot.slotId, evidenceIds: ['grade'], text: atoms[2]!.verbatimText}]}})
  expect(result.artifact.markdown).toContain(`- 示例大学：${atoms[2]!.verbatimText}`)
  expect(result.artifact.claims[0]!.evidenceIds).toEqual(['grade'])
})

test('source display strips page navigation only and retains every quantitative result and qualification', () => {
  const source = '- 代表成果：完成50+标签下线，覆盖率达到20.98%。目标、任务及激励项目成果见第2页。'
  const displayed = sourceBusinessDisplayText(source)
  expect(displayed).toContain('50+')
  expect(displayed).toContain('20.98%')
  expect(displayed).not.toContain('第2页')
  expect(sourceBusinessDisplayText('查看详情页上线3个月累计20万+次。')).toBe('查看详情页上线3个月累计20万+次。')
  expect(sourceBusinessDisplayText('尚未上线，结果需补证。')).toBe('尚未上线，结果需补证。')
})

test('an explicitly separated internship project retains its project identity and one unambiguous parent job', () => {
  const r = createV5ResultFixture()
  const source = canonicalizeSourceDocument('## 实习经历\n示例汽车 | 用户服务\n产品助理 2023.01-2023.07\n参与问卷研究。\n## 代表项目\n### 一线服务工具0到1\n示例汽车 | 产品助理 | 2023年实习期间\n结合问卷识别服务节点，交付PRD。', 'source-project-parent').canonicalDocument
  const template = r.resumeEvidenceBundle.evidenceAtoms[0]!
  const atoms = [2, 3, 5, 6, 7].map((index, ordinal) => ({...template, evidenceId: `proof:${ordinal}`,
    sourceScopeId: ordinal < 2 ? 'intern' : 'project', sourceBlockId: source.blocks[index]!.sourceBlockId,
    verbatimText: source.blocks[index]!.text, normalizedClaim: source.blocks[index]!.text}))
  const bundle = {...r.resumeEvidenceBundle, evidenceAtoms: atoms, timeline: [
    {scopeId: 'intern', kind: 'experience' as const, organization: '示例汽车', title: '产品助理', start: '2023.01', end: '2023.07', evidenceIds: ['proof:0', 'proof:1']},
    {scopeId: 'project', kind: 'internship' as const, organization: '示例汽车', title: '产品助理', start: '2023', end: '2023', evidenceIds: ['proof:2', 'proof:3', 'proof:4']},
  ]}
  const preserved = preserveSourceTimeline(source, bundle)
  expect(preserved.timeline[1]).toMatchObject({kind: 'project', title: '一线服务工具0到1', scopeId: 'project'})
  expect(preserved.sourceStructure?.nodes.find(node => node.scopeId === 'project')).toMatchObject({kind: 'project', parentScopeId: 'intern'})
  expect(preserved.evidenceAtoms).toEqual(atoms)
  const ambiguous = preserveSourceTimeline(source, {...bundle, timeline: [...bundle.timeline,
    {...bundle.timeline[0]!, scopeId: 'another-intern', evidenceIds: ['proof:0']} ]})
  expect(ambiguous.sourceStructure?.nodes.find(node => node.scopeId === 'project')?.parentScopeId).toBeNull()
})
