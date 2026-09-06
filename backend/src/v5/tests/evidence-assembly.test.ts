import { describe, expect, test } from 'bun:test'
import { deriveEvidenceAssemblies } from '@/v5/composition/evidence-assembly'
import type {
  EvidenceAtom,
  EvidenceClaimType,
  EvidenceRiskFlag,
  EvidenceStatus,
  ResumeEvidenceBundle,
  V5ResumePlan,
} from '@/v5/types'
import { V5_SCHEMA_VERSION } from '@/v5/types'

const DOCUMENT_HASH = 'sanitized-document-hash'
const WORK_SCOPE = 'scope-work'

function atom(input: {
  evidenceId: string
  sourceBlockId: string
  start: number
  end: number
  verbatimText: string
  claimType?: EvidenceClaimType
  status?: EvidenceStatus
  riskFlags?: EvidenceRiskFlag[]
  sourceDocumentHash?: string
  sourceScopeId?: string
}): EvidenceAtom {
  return {
    evidenceId: input.evidenceId,
    sourceDocumentHash: input.sourceDocumentHash ?? DOCUMENT_HASH,
    sourceBlockId: input.sourceBlockId,
    sourceScopeId: input.sourceScopeId ?? WORK_SCOPE,
    sourceSpan: { start: input.start, end: input.end },
    verbatimText: input.verbatimText,
    normalizedClaim: input.verbatimText,
    claimType: input.claimType ?? 'other',
    status: input.status ?? 'source_supported',
    attributionLevel: 'unspecified',
    sourceActionVerb: null,
    qualifiers: [],
    numericAtoms: [],
    riskFlags: input.riskFlags ?? [],
  }
}

function resume(evidenceAtoms: EvidenceAtom[]): ResumeEvidenceBundle {
  return {
    schemaVersion: V5_SCHEMA_VERSION,
    sourceDocument: {
      documentId: 'sanitized-document',
      sha256: DOCUMENT_HASH,
      primaryLanguage: 'zh-CN',
    },
    identity: {
      name: { value: null, evidenceIds: [] },
      email: { value: null, evidenceIds: [] },
      phone: { value: null, evidenceIds: [] },
      cityLevelLocation: { value: null, evidenceIds: [] },
      links: [],
    },
    timeline: [],
    sections: [],
    evidenceAtoms,
    unmappedFragments: [],
    conflicts: [],
    extractionCoverage: {
      sourceBlockCount: evidenceAtoms.length,
      mappedBlockCount: evidenceAtoms.length,
      unmappedBlockCount: 0,
      coverageRatio: 1,
      highImportanceUnmappedCount: 0,
      warnings: [],
    },
    qualityAssessment: {
      scoreInputs: {
        identityCompleteness: 0,
        timelineCompleteness: 0,
        evidenceResultDensity: 0,
        clarity: 0,
        sectionCoverage: 0,
      },
      strengths: [],
      weaknesses: [],
      suggestions: [],
      capabilitySummary: '',
      score: 0,
    },
  }
}

function plan(selectedByScope: Record<string, string[]>): V5ResumePlan {
  const selectedIds = Object.values(selectedByScope).flat()
  return {
    schemaVersion: V5_SCHEMA_VERSION,
    strategyProfile: {
      profileVersion: 'adaptive-v2',
      careerStage: 'unknown',
      evidenceShape: 'experience_led',
      evidenceRichness: 'sparse',
      targetDistance: 'direct',
      outputLanguage: 'zh-CN',
      confidence: 'low',
      reasons: [],
      metrics: {
        eligibleBusinessEvidenceCount: selectedIds.length,
        resultEvidenceCount: selectedIds.length,
        experienceScopeCount: Object.keys(selectedByScope).length,
        projectScopeCount: 0,
        researchScopeCount: 0,
        portfolioEvidenceCount: 0,
        highImportanceUnmappedCount: 0,
      },
    },
    generationPolicy: {
      policyVersion: 'adaptive-v2',
      mode: 'preserve_sparse',
      sectionOrder: ['experience'],
      summaryPolicy: 'omit_if_unsupported',
      targetBusinessBulletMin: 1,
      targetBusinessBulletTarget: 1,
      targetBusinessBulletMax: 3,
      hardTotalListItemMax: 12,
      hardProjectMax: 3,
      stableCoreCoverageMin: 1,
      primaryRequirementCoverageMin: 0,
      preferredDirectEvidenceRatio: { min: 0, max: 1 },
      outputLength: {
        unit: 'cjk_characters',
        softMin: null,
        hardMin: null,
        softMax: 1_000,
        hardMax: 1_500,
      },
      fallbackPolicy: 'source_preserving',
    },
    targetValueProposition: '',
    primaryRequirementIds: [],
    stableCoreEvidenceIds: selectedIds,
    customizedEvidenceIds: [],
    evidencePillars: [],
    scopePlans: Object.entries(selectedByScope).map(([scopeId, selectedEvidenceIds]) => ({
      scopeId,
      scopeType: 'experience',
      treatment: 'compress',
      selectedEvidenceIds,
      bulletBudget: Math.max(1, selectedEvidenceIds.length),
      rewriteAngle: 'source preserving',
    })),
    featuredSkillEvidenceIds: [],
    safeKeywordMappings: [],
    forbiddenRequirementIds: [],
    omittedHighValueEvidence: [],
    lowerBoundException: null,
  }
}

function sanitizedCaseLikeAtoms() {
  return [
    atom({ evidenceId: 'timeline-date', sourceBlockId: 'B0015', start: 10, end: 20, verbatimText: '时间字段', claimType: 'timeline', sourceScopeId: 'scope-timeline' }),
    atom({ evidenceId: 'timeline-org', sourceBlockId: 'B0016', start: 21, end: 31, verbatimText: '组织字段', claimType: 'timeline', sourceScopeId: 'scope-timeline' }),
    atom({ evidenceId: 'timeline-role', sourceBlockId: 'B0017', start: 32, end: 42, verbatimText: '职位字段', claimType: 'timeline', sourceScopeId: 'scope-timeline' }),
    atom({ evidenceId: 'unplanned-label', sourceBlockId: 'B0055', start: 100, end: 102, verbatimText: '维度' }),
    atom({ evidenceId: 'unplanned-detail', sourceBlockId: 'B0056', start: 103, end: 113, verbatimText: '能力条目' }),
    atom({ evidenceId: 'unplanned-result', sourceBlockId: 'B0057', start: 114, end: 124, verbatimText: '结果字段', claimType: 'result' }),
    atom({ evidenceId: 'planned-label', sourceBlockId: 'B0058', start: 126, end: 128, verbatimText: '执行' }),
    atom({ evidenceId: 'planned-detail', sourceBlockId: 'B0059', start: 129, end: 141, verbatimText: '任务与流程' }),
    atom({ evidenceId: 'planned-result', sourceBlockId: 'B0060', start: 142, end: 152, verbatimText: '交付结果', claimType: 'result' }),
  ]
}

describe('deriveEvidenceAssemblies', () => {
  test('keeps timeline and unplanned table runs out, while deriving the one planned companion assembly', () => {
    const evidenceAtoms = sanitizedCaseLikeAtoms()
    const result = deriveEvidenceAssemblies(
      resume(evidenceAtoms),
      plan({ [WORK_SCOPE]: ['planned-result'] })
    )

    expect(result).toEqual([{
      kind: 'companion_semicolon',
      joiner: 'semicolon',
      anchorEvidenceId: 'planned-result',
      plannedEvidenceIds: ['planned-result'],
      memberEvidenceIds: ['planned-label', 'planned-detail', 'planned-result'],
      sourceDocumentHash: DOCUMENT_HASH,
      sourceScopeId: WORK_SCOPE,
      firstSourceBlockId: 'B0058',
      lastSourceBlockId: 'B0060',
    }])
  })

  test('is insensitive to evidenceAtoms input order', () => {
    const evidenceAtoms = sanitizedCaseLikeAtoms()
    const targetPlan = plan({ [WORK_SCOPE]: ['planned-result'] })

    expect(deriveEvidenceAssemblies(resume([...evidenceAtoms].reverse()), targetPlan))
      .toEqual(deriveEvidenceAssemblies(resume(evidenceAtoms), targetPlan))
  })

  test('allows source_concat only when every member is planned business evidence and each lexical boundary is proven', () => {
    const evidenceAtoms = [
      atom({ evidenceId: 'action-left', sourceBlockId: 'B0100', start: 200, end: 210, verbatimText: '服务覆盖400+', claimType: 'action' }),
      atom({ evidenceId: 'result-right', sourceBlockId: 'B0101', start: 211, end: 225, verbatimText: '家门店并形成结果', claimType: 'result' }),
    ]

    expect(deriveEvidenceAssemblies(
      resume(evidenceAtoms),
      plan({ [WORK_SCOPE]: ['action-left', 'result-right'] })
    )).toEqual([expect.objectContaining({
      kind: 'source_concat',
      joiner: 'source_concat',
      anchorEvidenceId: 'action-left',
      plannedEvidenceIds: ['action-left', 'result-right'],
      memberEvidenceIds: ['action-left', 'result-right'],
    })])

    const withoutProvableBoundary = evidenceAtoms.map(item => (
      item.evidenceId === 'action-left'
        ? { ...item, verbatimText: '推进需求', normalizedClaim: '推进需求' }
        : item
    ))
    expect(deriveEvidenceAssemblies(
      resume(withoutProvableBoundary),
      plan({ [WORK_SCOPE]: ['action-left', 'result-right'] })
    )).toEqual([])
  })

  test('rejects metadata atoms even when they are mechanically adjacent to a planned business anchor', () => {
    for (const claimType of ['timeline', 'identity', 'skill', 'education'] as const) {
      const evidenceAtoms = [
        atom({ evidenceId: `metadata-${claimType}`, sourceBlockId: 'B0200', start: 300, end: 310, verbatimText: '元数据字段', claimType }),
        atom({ evidenceId: `anchor-${claimType}`, sourceBlockId: 'B0201', start: 311, end: 321, verbatimText: '业务结果', claimType: 'result' }),
      ]
      expect(deriveEvidenceAssemblies(
        resume(evidenceAtoms),
        plan({ [WORK_SCOPE]: [`anchor-${claimType}`] })
      )).toEqual([])
    }
  })

  test('rejects the whole maximal run when any member is risky or source-qualified', () => {
    const base = [
      atom({ evidenceId: 'label', sourceBlockId: 'B0300', start: 400, end: 405, verbatimText: '维度' }),
      atom({ evidenceId: 'detail', sourceBlockId: 'B0301', start: 406, end: 416, verbatimText: '业务条目' }),
      atom({ evidenceId: 'anchor', sourceBlockId: 'B0302', start: 417, end: 427, verbatimText: '业务结果', claimType: 'result' }),
    ]
    const targetPlan = plan({ [WORK_SCOPE]: ['anchor'] })
    const risky = base.map(item => item.evidenceId === 'detail'
      ? { ...item, riskFlags: ['uncertain' as const] }
      : item)
    const qualified = base.map(item => item.evidenceId === 'detail'
      ? { ...item, status: 'source_qualified' as const }
      : item)

    expect(deriveEvidenceAssemblies(resume(risky), targetPlan)).toEqual([])
    expect(deriveEvidenceAssemblies(resume(qualified), targetPlan)).toEqual([])
  })

  test('rejects reverse source coordinates, skipped block ordinals and oversized maximal runs', () => {
    const targetPlan = plan({ [WORK_SCOPE]: ['anchor'] })
    const reversedCoordinates = [
      atom({ evidenceId: 'label', sourceBlockId: 'B0400', start: 510, end: 520, verbatimText: '维度' }),
      atom({ evidenceId: 'anchor', sourceBlockId: 'B0401', start: 500, end: 509, verbatimText: '业务结果', claimType: 'result' }),
    ]
    const skippedBlock = [
      atom({ evidenceId: 'label', sourceBlockId: 'B0500', start: 600, end: 610, verbatimText: '维度' }),
      atom({ evidenceId: 'anchor', sourceBlockId: 'B0502', start: 611, end: 621, verbatimText: '业务结果', claimType: 'result' }),
    ]
    const oversized = [
      atom({ evidenceId: 'label-1', sourceBlockId: 'B0600', start: 700, end: 710, verbatimText: '维度一' }),
      atom({ evidenceId: 'label-2', sourceBlockId: 'B0601', start: 711, end: 721, verbatimText: '维度二' }),
      atom({ evidenceId: 'anchor', sourceBlockId: 'B0602', start: 722, end: 732, verbatimText: '业务结果', claimType: 'result' }),
      atom({ evidenceId: 'label-3', sourceBlockId: 'B0603', start: 733, end: 743, verbatimText: '维度三' }),
    ]

    expect(deriveEvidenceAssemblies(resume(reversedCoordinates), targetPlan)).toEqual([])
    expect(deriveEvidenceAssemblies(resume(skippedBlock), targetPlan)).toEqual([])
    expect(deriveEvidenceAssemblies(resume(oversized), targetPlan)).toEqual([])
  })

  test('rejects span gaps, document mismatches and scope boundaries', () => {
    const targetPlan = plan({ [WORK_SCOPE]: ['anchor'] })
    const spanGap = [
      atom({ evidenceId: 'label', sourceBlockId: 'B0650', start: 750, end: 760, verbatimText: '维度' }),
      atom({ evidenceId: 'anchor', sourceBlockId: 'B0651', start: 762, end: 772, verbatimText: '业务结果', claimType: 'result' }),
    ]
    const documentMismatch = [
      atom({ evidenceId: 'label', sourceBlockId: 'B0650', start: 750, end: 760, verbatimText: '维度', sourceDocumentHash: 'other-document' }),
      atom({ evidenceId: 'anchor', sourceBlockId: 'B0651', start: 761, end: 771, verbatimText: '业务结果', claimType: 'result', sourceDocumentHash: 'other-document' }),
    ]
    const scopeBoundary = [
      atom({ evidenceId: 'label', sourceBlockId: 'B0650', start: 750, end: 760, verbatimText: '维度', sourceScopeId: 'scope-other' }),
      atom({ evidenceId: 'anchor', sourceBlockId: 'B0651', start: 761, end: 771, verbatimText: '业务结果', claimType: 'result' }),
    ]

    expect(deriveEvidenceAssemblies(resume(spanGap), targetPlan)).toEqual([])
    expect(deriveEvidenceAssemblies(resume(documentMismatch), targetPlan)).toEqual([])
    expect(deriveEvidenceAssemblies(resume(scopeBoundary), targetPlan)).toEqual([])
  })

  test('never assigns one atom to overlapping assemblies', () => {
    const evidenceAtoms = [
      atom({ evidenceId: 'first-label', sourceBlockId: 'B0700', start: 800, end: 810, verbatimText: '维度甲' }),
      atom({ evidenceId: 'first-anchor', sourceBlockId: 'B0701', start: 811, end: 821, verbatimText: '结果甲', claimType: 'result' }),
      atom({ evidenceId: 'second-label', sourceBlockId: 'B0710', start: 900, end: 910, verbatimText: '维度乙' }),
      atom({ evidenceId: 'second-anchor', sourceBlockId: 'B0711', start: 911, end: 921, verbatimText: '结果乙', claimType: 'result' }),
    ]
    const result = deriveEvidenceAssemblies(
      resume(evidenceAtoms),
      plan({ [WORK_SCOPE]: ['first-anchor', 'second-anchor'] })
    )
    const memberIds = result.flatMap(item => item.memberEvidenceIds)

    expect(result).toHaveLength(2)
    expect(new Set(memberIds).size).toBe(memberIds.length)
  })
})
