import { describe, expect, test } from 'bun:test'
import { canonicalizeSourceDocument } from '@/v5/canonical-source'
import {
  buildResumeExtractionScopePlan,
  DEFAULT_RESUME_EXTRACTION_CONCURRENCY,
  DEFAULT_RESUME_EXTRACTION_MAX_CHARACTERS,
  DEFAULT_RESUME_EXTRACTION_MAX_BLOCKS,
  DEFAULT_RESUME_EXTRACTION_MAX_ESTIMATED_OUTPUT_TOKENS,
  estimateResumeExtractionOutputTokens,
  normalizeResumeExtractionChunkCandidate,
  orderResumeExtractionCandidates,
  readResumeExtractionScopePlan,
  RESUME_EXTRACTION_CHUNK_PLAN_VERSION,
  RESUME_EXTRACTION_OUTPUT_TOKENS_PER_FACT,
  resumeExtractionRawFactCandidateLimit,
  resumeExtractionFactCandidateLimit,
  resumeExtractionFactCandidateStorageLimit,
  resumeExtractionFactCandidateTransportLimit,
  resumeExtractionInitialRepairBudget,
  resumeExtractionMaxRepairBudget,
  ResumeExtractionChunkCapacityError,
  ResumeExtractionChunkPlanError,
  settleResumeExtractionBatch,
  splitResumeDocument,
  validateResumeExtractionChunkPlan,
} from '@/v5/chunked-resume-extraction'
import { createResumeFixture } from '@/v5/tests/fixtures'
import { validateResumeExtractionCandidate, buildResumeEvidenceBundle } from '@/v5/evidence'
import { buildEvidencePlanningCatalog } from '@/v5/evidence-routing'

function chunksFor(markdown: string, maxBlocks: number) {
  const document = canonicalizeSourceDocument(markdown, 'chunk-test').canonicalDocument
  return { document, chunks: splitResumeDocument(document, maxBlocks) }
}

describe('v5 resume extraction chunk boundaries', () => {
  test('keeps unassigned overview metrics without borrowing a later server-owned job scope', () => {
    const { document, candidate } = createResumeFixture()
    const chunk = splitResumeDocument(document)[0]
    const scope = chunk.extractionScopeAssignments![0].serverScopeLocalId
    candidate.factCandidates[0] = { ...candidate.factCandidates[0], claimType: 'result', sourceScopeLocalId: scope }
    candidate.timelineCandidates[0].scopeLocalId = scope
    candidate.timelineCandidates[0].factLocalIds.unshift('f1')
    const original = structuredClone(candidate)
    const normalized = normalizeResumeExtractionChunkCandidate(chunk, candidate)
    expect(normalized.factCandidates[0]).toEqual({ ...candidate.factCandidates[0], claimType: 'other', sourceScopeLocalId: 'unscoped_source' })
    expect(normalized.timelineCandidates[0].factLocalIds).not.toContain('f1')
    expect(normalized.coverageClaim.mappedSourceBlockIds).toContain('B0001')
    expect(candidate).toEqual(original)
    expect(normalizeResumeExtractionChunkCandidate(chunk, normalized)).toEqual(normalized)
    expect(validateResumeExtractionCandidate(chunk, normalized).passed).toBe(true)
    const bundle = buildResumeEvidenceBundle(chunk, normalized)
    const overview = bundle.evidenceAtoms.find(a => a.sourceBlockId === 'B0001')!
    expect(buildEvidencePlanningCatalog(bundle).businessAnchorEvidenceIds).not.toContain(overview.evidenceId)
  })

  test('an explicit empty scope plan cannot be replaced by model-invented business timelines', () => {
    const { document, candidate } = createResumeFixture()
    const chunk = { ...document, extractionScopeAssignments: [] }
    const normalized = normalizeResumeExtractionChunkCandidate(chunk, candidate)
    expect(normalized.timelineCandidates).toHaveLength(0)
    expect(normalized.factCandidates[2].sourceScopeLocalId).toBe('unscoped_source')
    expect(normalized.factCandidates[2].claimType).toBe('other')
    expect(normalized.factCandidates[2].verbatimText).toBe(candidate.factCandidates[2].verbatimText)
    expect(normalized.factCandidates[2].riskFlags).toEqual(candidate.factCandidates[2].riskFlags)
    expect(normalized.factCandidates[2].proposedStatus).toBe(candidate.factCandidates[2].proposedStatus)
    expect(normalizeResumeExtractionChunkCandidate(document, candidate)).toBe(candidate)
  })

  test('preserves duplicate fact IDs untouched for canonical fail-closed validation', () => {
    const { document, candidate } = createResumeFixture()
    const chunk = splitResumeDocument(document)[0]
    candidate.factCandidates.push(structuredClone(candidate.factCandidates[2]))

    expect(normalizeResumeExtractionChunkCandidate(chunk, candidate)).toBe(candidate)
  })

  test('restores server sequence after provider-like calls complete in reverse order', async () => {
    const candidates = ['first', 'second', 'third'].map(label => ({ label }))
    const completionOrder: number[] = []
    const completed = await settleResumeExtractionBatch(candidates.map(async (candidate, chunkIndex) => {
      for (let delay = 0; delay < candidates.length - chunkIndex - 1; delay += 1) await Promise.resolve()
      completionOrder.push(chunkIndex)
      return { chunkIndex, candidate }
    }))
    const ordered = orderResumeExtractionCandidates(completed, 3)

    expect(completionOrder).toEqual([2, 1, 0])
    expect(ordered.map(item => item.label)).toEqual(['first', 'second', 'third'])
    expect(() => orderResumeExtractionCandidates([
      { chunkIndex: 0, candidate: candidates[0] },
      { chunkIndex: 0, candidate: candidates[1] },
    ], 2)).toThrow('P01 chunk sequence invalid')
  })

  test('waits for every started chunk before surfacing a batch failure', async () => {
    let siblingSettled = false
    const sibling = new Promise<{ chunkIndex: number; candidate: string }>(resolve => {
      queueMicrotask(() => {
        siblingSettled = true
        resolve({ chunkIndex: 1, candidate: 'completed' })
      })
    })

    let error: unknown
    try {
      await settleResumeExtractionBatch([
        Promise.reject(new Error('chunk failed')),
        sibling,
      ])
    } catch (caught) {
      error = caught
    }

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe('chunk failed')
    expect(siblingSettled).toBe(true)
  })

  test('uses a conservative extraction concurrency default', () => {
    expect(DEFAULT_RESUME_EXTRACTION_CONCURRENCY).toBe(2)
    expect(DEFAULT_RESUME_EXTRACTION_MAX_BLOCKS).toBe(24)
    expect(DEFAULT_RESUME_EXTRACTION_MAX_CHARACTERS).toBe(1_000)
    expect(DEFAULT_RESUME_EXTRACTION_MAX_ESTIMATED_OUTPUT_TOKENS).toBe(15_500)
    expect(RESUME_EXTRACTION_OUTPUT_TOKENS_PER_FACT).toBe(400)
    expect(RESUME_EXTRACTION_CHUNK_PLAN_VERSION).toBe('deterministic-scope-plan-v10')
  })

  test('scales the initial repair window and hard ceiling with the trusted shard plan', () => {
    expect([1, 2, 8, 14].map(shardCount => [
      resumeExtractionInitialRepairBudget(shardCount),
      resumeExtractionMaxRepairBudget(shardCount),
    ])).toEqual([[1, 1], [1, 1], [2, 4], [3, 7]])

    for (const invalidCount of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => resumeExtractionInitialRepairBudget(invalidCount)).toThrow(RangeError)
      expect(() => resumeExtractionMaxRepairBudget(invalidCount)).toThrow(RangeError)
    }
  })

  test('calibrates mixed fact density without weakening the hard output ceiling', () => {
    const blocks = [
      ...Array.from({ length: 17 }, () => ({ text: 'one fact' })),
      ...Array.from({ length: 6 }, () => ({ text: `- ${'A'.repeat(64)}` })),
    ]

    expect(resumeExtractionFactCandidateLimit(blocks)).toBe(29)
    expect(resumeExtractionFactCandidateTransportLimit(blocks)).toBe(33)
    expect(resumeExtractionFactCandidateStorageLimit(blocks, 3)).toBe(41)
    expect(resumeExtractionRawFactCandidateLimit(blocks)).toBe(42)
    expect(estimateResumeExtractionOutputTokens(blocks)).toBeLessThanOrEqual(
      DEFAULT_RESUME_EXTRACTION_MAX_ESTIMATED_OUTPUT_TOKENS
    )
  })

  test('avoids over-fragmenting a compact resume while preserving scope boundaries', () => {
    const scopes = Array.from({ length: 8 }, (_, index) => [
      `### Company ${index + 1}`,
      ...Array.from({ length: 19 }, (__, bulletIndex) => `- Result ${index + 1}.${bulletIndex + 1}`),
    ]).flat()
    const document = canonicalizeSourceDocument([
      '# Candidate',
      '## Work Experience',
      ...scopes,
    ].join('\n'), 'compact-long-resume').canonicalDocument

    const chunks = splitResumeDocument(document)

    expect(chunks).toHaveLength(8)
    expect(chunks[0].blocks).toHaveLength(22)
    expect(chunks.slice(1).every(chunk => chunk.blocks.length === 20)).toBe(true)
    expect(chunks.flatMap(chunk => chunk.blocks.map(block => block.sourceBlockId)))
      .toEqual(document.blocks.map(block => block.sourceBlockId))
  })

  test('shards a detailed experience without changing the nested subsection scope', () => {
    const { document, chunks } = chunksFor([
      '# 张三',
      '## 工作经历',
      '### 甲公司｜产品经理',
      '- 负责需求分析',
      '#### 关键成果',
      '- 交付项目 A',
      '- 推动项目上线',
      '### 乙公司｜产品助理',
      '- 支持用户调研',
      '## 专业技能',
      '- SQL',
    ].join('\n'), 3)

    expect(chunks.map(chunk => chunk.blocks.length)).toEqual([2, 3, 2, 2, 2])
    const firstExperienceIds = document.blocks.slice(2, 7).map(block => block.sourceBlockId)
    const firstExperienceAssignments = chunks
      .flatMap(chunk => chunk.extractionScopeAssignments ?? [])
      .filter(assignment => assignment.sourceBlockIds.some(id => firstExperienceIds.includes(id)))
    expect(firstExperienceAssignments.flatMap(assignment => assignment.sourceBlockIds)).toEqual(firstExperienceIds)
    expect(new Set(firstExperienceAssignments.map(assignment => assignment.serverScopeLocalId)).size).toBe(1)
    expect(firstExperienceAssignments.every(assignment => (
      assignment.scopeMemberBlockIds?.join(',') === firstExperienceIds.join(',')
    ))).toBe(true)
  })

  test('packs adjacent logical scopes without exceeding the target where possible', () => {
    const { chunks } = chunksFor([
      '# Candidate',
      '## Work Experience',
      '### Company A | Engineer',
      '- Built A',
      '### Company B | Engineer',
      '- Built B',
      '## Skills',
      '- TypeScript',
    ].join('\n'), 4)

    expect(chunks.map(chunk => chunk.blocks.map(block => block.text))).toEqual([
      ['# Candidate', '## Work Experience', '### Company A | Engineer', '- Built A'],
      ['### Company B | Engineer', '- Built B', '## Skills', '- TypeScript'],
    ])
    expect(chunks.map(chunk => chunk.extractionScopeAssignments?.length ?? 0)).toEqual([1, 1])
    expect(chunks.flatMap(chunk => chunk.extractionScopeAssignments ?? [])
      .every(assignment => assignment.sourceBlockIds.length === 2)).toBe(true)
  })

  test('splits a dense 27-block batch before it reaches the P01 output ceiling', () => {
    const document = canonicalizeSourceDocument([
      '# Candidate',
      '## Work Experience',
      ...Array.from({ length: 4 }, (_, scopeIndex) => [
        `### Company ${scopeIndex + 1} | Engineer`,
        ...Array.from({ length: 5 }, (__, bulletIndex) => `- Delivered item ${scopeIndex + 1}.${bulletIndex + 1}`),
      ]).flat(),
      '## Skills',
    ].join('\n'), 'dense-27-block-resume').canonicalDocument

    expect(document.blocks).toHaveLength(27)
    const chunks = splitResumeDocument(document)

    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every(chunk => chunk.blocks.length <= DEFAULT_RESUME_EXTRACTION_MAX_BLOCKS)).toBe(true)
    expect(chunks.flatMap(chunk => chunk.blocks.map(block => block.sourceBlockId)))
      .toEqual(document.blocks.map(block => block.sourceBlockId))
  })

  test('splits cap-three source blocks by output density and preserves every target in order', () => {
    const document = canonicalizeSourceDocument(
      Array.from({ length: 24 }, (_, index) => (
        `事实 ${index}；独立补充 ${index}；独立结果 ${index}`
      )).join('\n'),
      'dense-multi-fact-resume'
    ).canonicalDocument
    const chunks = splitResumeDocument(document)

    expect(resumeExtractionFactCandidateLimit(document.blocks)).toBe(72)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every(chunk => (
      estimateResumeExtractionOutputTokens(chunk.blocks)
        <= DEFAULT_RESUME_EXTRACTION_MAX_ESTIMATED_OUTPUT_TOKENS
    ))).toBe(true)
    expect(chunks.flatMap(chunk => chunk.blocks.map(block => block.sourceBlockId)))
      .toEqual(document.blocks.map(block => block.sourceBlockId))
  })

  test('shards an unheaded timeline without absorbing identity or skill lines', () => {
    const { document, chunks } = chunksFor([
      '张三',
      '甲公司｜产品经理｜2022-至今',
      '负责产品规划',
      '交付三个版本',
      '技能：SQL',
    ].join('\n'), 2)

    expect(chunks).toHaveLength(4)
    expect(chunks.flatMap(chunk => chunk.blocks)).toEqual(document.blocks)
    const plan = buildResumeExtractionScopePlan(document)
    expect(plan.scopes[0].memberBlockIds).toEqual(['B0002', 'B0003', 'B0004'])
    expect(plan.scopeBySourceBlockId.has('B0001')).toBe(false)
    expect(plan.scopeBySourceBlockId.has('B0005')).toBe(false)
    expect(new Set(chunks.flatMap(chunk => (
      chunk.extractionScopeAssignments?.map(assignment => assignment.serverScopeLocalId) ?? []
    ))).size).toBe(1)
    expect(chunks.filter(chunk => chunk.extractionScopeContext).every(chunk => (
      chunk.extractionScopeContext?.blocks.map(block => block.sourceBlockId).join(',') === 'B0002'
    ))).toBe(true)
  })

  test('separates multiple unheaded roles by metadata and date anchors', () => {
    const document = canonicalizeSourceDocument([
      '张三',
      '甲公司',
      '产品经理',
      '2022-2023',
      '交付成果 A',
      '乙公司',
      '工程师',
      '2023-Present',
      '交付成果 B',
      '技能：SQL',
    ].join('\n'), 'unheaded-multiple-roles').canonicalDocument
    const plan = buildResumeExtractionScopePlan(document)

    expect(plan.scopes.map(scope => scope.memberBlockIds)).toEqual([
      ['B0002', 'B0003', 'B0004', 'B0005'],
      ['B0006', 'B0007', 'B0008', 'B0009'],
    ])
    expect(plan.scopes[0].serverScopeLocalId).not.toBe(plan.scopes[1].serverScopeLocalId)
    expect(plan.scopeBySourceBlockId.has('B0001')).toBe(false)
    expect(plan.scopeBySourceBlockId.has('B0010')).toBe(false)
  })

  test('separates flat roles that follow a Markdown candidate heading', () => {
    const document = canonicalizeSourceDocument([
      '# 张三 | 产品经理',
      '甲公司',
      '产品经理',
      '2022-2023',
      '交付成果 A',
      '乙公司',
      '工程师',
      '2023-Present',
      '交付成果 B',
      '## 技能',
      '- SQL',
    ].join('\n'), 'heading-plus-flat-roles').canonicalDocument
    const plan = buildResumeExtractionScopePlan(document)

    expect(plan.scopes.map(scope => scope.memberBlockIds)).toEqual([
      ['B0002', 'B0003', 'B0004', 'B0005'],
      ['B0006', 'B0007', 'B0008', 'B0009'],
    ])
    expect(plan.scopes[0].serverScopeLocalId).not.toBe(plan.scopes[1].serverScopeLocalId)
    expect(plan.scopeBySourceBlockId.has('B0001')).toBe(false)
    expect(plan.scopeBySourceBlockId.has('B0010')).toBe(false)
    expect(plan.scopeBySourceBlockId.has('B0011')).toBe(false)
  })

  test('plans flat roles inside a Markdown work section', () => {
    const document = canonicalizeSourceDocument([
      '# Candidate',
      '## Work Experience',
      'Company A',
      'Product Manager',
      '2022-2023',
      'Delivered A',
      'Company B',
      'Engineer',
      '2023-Present',
      'Delivered B',
      '## Skills',
      '- SQL',
    ].join('\n'), 'work-heading-plus-flat-roles').canonicalDocument
    const plan = buildResumeExtractionScopePlan(document)
    const chunks = splitResumeDocument(document)

    expect(plan.scopes.map(scope => scope.memberBlockIds)).toEqual([
      ['B0003', 'B0004', 'B0005', 'B0006'],
      ['B0007', 'B0008', 'B0009', 'B0010'],
    ])
    expect(chunks.flatMap(chunk => chunk.extractionScopeAssignments ?? []).map(assignment => (
      assignment.sourceBlockIds
    ))).toEqual([
      ['B0003', 'B0004', 'B0005', 'B0006'],
      ['B0007', 'B0008', 'B0009', 'B0010'],
    ])
    expect(plan.scopeBySourceBlockId.has('B0001')).toBe(false)
    expect(plan.scopeBySourceBlockId.has('B0002')).toBe(false)
    expect(plan.scopeBySourceBlockId.has('B0011')).toBe(false)
    expect(plan.scopeBySourceBlockId.has('B0012')).toBe(false)
  })

  test('preserves source order and assigns every block to exactly one chunk', () => {
    const { document, chunks } = chunksFor([
      '# Candidate',
      '## Projects',
      '### Project A',
      '- Result A',
      '### Project B',
      '- Result B',
      '### Project C',
      '- Result C',
    ].join('\n'), 3)

    const chunkedIds = chunks.flatMap(chunk => chunk.blocks.map(block => block.sourceBlockId))
    expect(chunkedIds).toEqual(document.blocks.map(block => block.sourceBlockId))
    expect(new Set(chunkedIds).size).toBe(document.blocks.length)
  })

  test('rejects an invalid block target instead of entering a non-terminating split loop', () => {
    const document = canonicalizeSourceDocument('A\nB', 'invalid-limit').canonicalDocument
    expect(() => splitResumeDocument(document, 0)).toThrow(RangeError)
    expect(() => splitResumeDocument(document, 1.5)).toThrow(RangeError)
  })

  test('uses character capacity as a hard boundary while preserving every source block once', () => {
    const { document, chunks } = chunksFor([
      '# Candidate',
      '## Projects',
      '### Project A',
      `- ${'A'.repeat(320)}`,
      '### Project B',
      `- ${'B'.repeat(320)}`,
      '### Project C',
      `- ${'C'.repeat(320)}`,
    ].join('\n'), 24)

    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every(chunk => chunk.blocks.reduce((sum, block) => sum + block.text.length, 0) <= 1_000)).toBe(true)
    expect(chunks.flatMap(chunk => chunk.blocks.map(block => block.sourceBlockId)))
      .toEqual(document.blocks.map(block => block.sourceBlockId))
  })

  test('fails closed when one indivisible scope exceeds hard output capacity', () => {
    const document = canonicalizeSourceDocument([
      '## Work Experience',
      '### One oversized role',
      `- ${'结果'.repeat(600)}`,
    ].join('\n'), 'oversized-scope').canonicalDocument

    expect(() => splitResumeDocument(document)).toThrow(ResumeExtractionChunkCapacityError)
  })

  test('shards oversized output while repeating only anchor context and targeting every block once', () => {
    const document = canonicalizeSourceDocument([
      '# Candidate',
      '## Work Experience',
      '### Company A | Product Manager | 2021-Present',
      ...Array.from({ length: 30 }, (_, index) => `- Delivered result ${index + 1}`),
    ].join('\n'), 'scope-output-shards').canonicalDocument

    const chunks = splitResumeDocument(document)
    const scopedChunks = chunks.filter(chunk => chunk.extractionScopeContext)
    const targetIds = chunks.flatMap(chunk => chunk.blocks.map(block => block.sourceBlockId))

    expect(scopedChunks).toHaveLength(2)
    expect(targetIds).toEqual(document.blocks.map(block => block.sourceBlockId))
    expect(new Set(targetIds).size).toBe(document.blocks.length)
    expect(scopedChunks.every(chunk => chunk.blocks.length <= DEFAULT_RESUME_EXTRACTION_MAX_BLOCKS)).toBe(true)
    expect(scopedChunks.every(chunk => chunk.extractionScopeContext?.blocks.length === 1)).toBe(true)
    expect(scopedChunks.every(chunk => chunk.extractionScopeContext?.scopeMemberBlockIds?.length === 31)).toBe(true)
    expect(new Set(scopedChunks.map(chunk => chunk.extractionScopeContext?.serverScopeLocalId)).size).toBe(1)
  })

  test('keeps an H1 current-role child section in the parent server scope', () => {
    const document = canonicalizeSourceDocument([
      '# Company A | Product',
      'Current role overview',
      'Product Manager',
      '2025. 06-Present',
      'Owned product delivery',
      '## Product portfolio',
      '- Delivered module A',
    ].join('\n'), 'h1-current-role').canonicalDocument

    const chunks = splitResumeDocument(document, 5)
    const assignments = chunks.flatMap(chunk => chunk.extractionScopeAssignments ?? [])

    expect(assignments).toHaveLength(2)
    expect(assignments[0].sourceBlockIds).toEqual(['B0001', 'B0002', 'B0003', 'B0004', 'B0005'])
    expect(assignments[1].sourceBlockIds).toEqual(['B0006', 'B0007'])
    expect(assignments[0].serverScopeLocalId).toBe(assignments[1].serverScopeLocalId)
    expect(assignments[0].timelineAnchorBlockIds).toEqual(['B0001', 'B0002', 'B0003', 'B0004'])
    expect(assignments[1].scopeMemberBlockIds).toEqual(document.blocks.map(block => block.sourceBlockId))
  })

  test('emits one server assignment for a short H1 role and child at default capacity', () => {
    const document = canonicalizeSourceDocument([
      '# Company A | Product Manager',
      '2024-Present',
      '## An unrecognized child heading',
      '- Delivered A',
    ].join('\n'), 'short-h1-child').canonicalDocument
    const chunks = splitResumeDocument(document)
    const assignments = chunks[0].extractionScopeAssignments ?? []

    expect(chunks).toHaveLength(1)
    expect(assignments).toHaveLength(1)
    expect(assignments[0].sourceBlockIds).toEqual(document.blocks.map(block => block.sourceBlockId))
    expect(assignments[0].timelineAnchorBlockIds).toEqual(['B0001', 'B0002'])
  })

  test('recognizes common Chinese year-month ranges as timeline anchors', () => {
    for (const [index, range] of [
      '2025年06月-至今',
      '2025年06月至今',
      '2025.06 至今',
    ].entries()) {
      const document = canonicalizeSourceDocument([
        '# Company A | Product Manager',
        range,
        '## 任意子节',
        '- Delivered A',
      ].join('\n'), `zh-timeline-${index}`).canonicalDocument
      const plan = buildResumeExtractionScopePlan(document)

      expect(plan.scopes).toHaveLength(1)
      expect(plan.scopes[0].memberBlockIds).toEqual(['B0001', 'B0002', 'B0003', 'B0004'])
      expect(plan.scopes[0].timelineAnchorBlockIds).toEqual(['B0001', 'B0002'])
    }
  })

  test('inherits arbitrary child headings under a timeline anchor without title whitelists', () => {
    const document = canonicalizeSourceDocument([
      '# 益丰大药房 | 营运效能产品',
      '益丰大药房连锁股份有限公司 | 数字化中心',
      '中级产品经理',
      '2025. 06-至今',
      '角色概述',
      '## 产品组合与角色',
      '- 事实一',
      '- 事实二',
      '- 事实三',
      '- 事实四',
      '- 事实五',
      '## 能力中心与方法沉淀',
      '- 事实六',
      '## 集团级目标治理',
      '- 事实七',
    ].join('\n'), 'parent-child-scope').canonicalDocument

    const chunks = splitResumeDocument(document, 6)
    const plan = buildResumeExtractionScopePlan(document)
    const scopeIds = document.blocks.map(block => plan.scopeBySourceBlockId.get(block.sourceBlockId))

    expect(plan.scopes).toHaveLength(1)
    expect(new Set(scopeIds).size).toBe(1)
    expect(plan.scopes[0].timelineAnchorBlockIds).toEqual(['B0001', 'B0002', 'B0003', 'B0004'])
    expect(new Set(chunks.flatMap(chunk => (
      chunk.extractionScopeAssignments?.map(assignment => assignment.serverScopeLocalId) ?? []
    ))).size).toBe(1)
  })

  test('closes inheritance monotonically at new timelines and structural sections', () => {
    const document = canonicalizeSourceDocument([
      '# Company A | Product Manager | 2022-2023',
      '## 任意子节',
      '- Delivered A',
      '# Company B | Engineer | 2023-Present',
      '## Another arbitrary child',
      '- Delivered B',
      '## Skills',
      '- TypeScript',
      '## 后续附录',
      '- Notes',
    ].join('\n'), 'monotonic-boundaries').canonicalDocument

    const plan = buildResumeExtractionScopePlan(document)
    const firstScope = plan.scopeBySourceBlockId.get('B0001')
    const secondScope = plan.scopeBySourceBlockId.get('B0004')

    expect(firstScope).toBeTruthy()
    expect(secondScope).toBeTruthy()
    expect(firstScope).not.toBe(secondScope)
    expect(plan.scopeBySourceBlockId.get('B0002')).toBe(firstScope)
    expect(plan.scopeBySourceBlockId.get('B0005')).toBe(secondScope)
    expect(plan.scopeBySourceBlockId.has('B0007')).toBe(false)
    expect(plan.scopeBySourceBlockId.get('B0009')).not.toBe(secondScope)
  })

  test('keeps independent projects under a structural project section isolated', () => {
    const document = canonicalizeSourceDocument([
      '# Candidate',
      '## Projects',
      '### Project A',
      '- Result A',
      '### Project B',
      '- Result B',
    ].join('\n'), 'independent-projects').canonicalDocument
    const plan = buildResumeExtractionScopePlan(document)

    expect(plan.scopeBySourceBlockId.get('B0003')).toBe(plan.scopeBySourceBlockId.get('B0004'))
    expect(plan.scopeBySourceBlockId.get('B0005')).toBe(plan.scopeBySourceBlockId.get('B0006'))
    expect(plan.scopeBySourceBlockId.get('B0003')).not.toBe(plan.scopeBySourceBlockId.get('B0005'))
    expect(plan.scopeBySourceBlockId.has('B0002')).toBe(false)
  })

  test('joins adjacent organization-only and role-with-date headings as one metadata anchor', () => {
    const document = canonicalizeSourceDocument([
      '## 上海蔚来汽车有限公司｜用户服务与体验',
      '## 产品助理',
      '2021.01-2021.06',
    ].join('\n'), 'adjacent-metadata-plan').canonicalDocument
    const plan = buildResumeExtractionScopePlan(document)
    const chunks = splitResumeDocument(document)

    expect(plan.scopes).toHaveLength(1)
    expect(plan.scopes[0].memberBlockIds).toEqual(['B0001', 'B0002', 'B0003'])
    expect(plan.scopes[0].timelineAnchorBlockIds).toEqual(['B0001', 'B0002', 'B0003'])
    expect(chunks[0].extractionScopeAssignments).toHaveLength(1)
  })

  test('reads complete trusted ownership from a continuation shard', () => {
    const document = canonicalizeSourceDocument([
      '# Company A | Product Manager | 2021-Present',
      ...Array.from({ length: 12 }, (_, index) => `- Result ${index + 1}`),
    ].join('\n'), 'read-shard-plan').canonicalDocument
    const continuation = splitResumeDocument(document, 5)[1]
    const plan = readResumeExtractionScopePlan(continuation)
    const scope = plan.scopes[0]

    expect(scope.hasCompleteScopeContext).toBe(true)
    expect(scope.hasTrustedAnchorContext).toBe(true)
    expect(scope.memberBlockIds).toEqual(document.blocks.map(block => block.sourceBlockId))
    expect(scope.timelineAnchorBlockIds).toEqual(['B0001'])
    expect(continuation.blocks.every(block => (
      plan.scopeBySourceBlockId.get(block.sourceBlockId) === scope.serverScopeLocalId
    ))).toBe(true)
  })

  test('fails local preflight before provider work when chunk order or scope ownership is corrupted', () => {
    const document = canonicalizeSourceDocument([
      '## Work Experience',
      '### Company A | Engineer',
      '- Result A',
      '### Company B | Engineer',
      '- Result B',
    ].join('\n'), 'scope-plan-preflight').canonicalDocument
    const chunks = splitResumeDocument(document, 3)

    expect(() => validateResumeExtractionChunkPlan(document, [...chunks].reverse()))
      .toThrow(ResumeExtractionChunkPlanError)
    const corrupted = structuredClone(chunks)
    corrupted[0].extractionScopeAssignments![0].serverScopeLocalId = 'srv_scope_corrupted'
    try {
      validateResumeExtractionChunkPlan(document, corrupted)
      throw new Error('expected preflight failure')
    } catch (error) {
      expect(error).toBeInstanceOf(ResumeExtractionChunkPlanError)
      expect((error as ResumeExtractionChunkPlanError).code).toBe('P01_SCOPE_PLAN_INVALID')
    }
  })
})
