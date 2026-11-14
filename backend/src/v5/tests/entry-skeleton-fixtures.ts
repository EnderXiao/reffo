import { FIVE_ELEMENTS, type GapDecision } from '@/v5/writing/entry-skeleton'
import type { entryWritingPayload } from '@/v5/writing/entries'

type Brief = ReturnType<typeof entryWritingPayload>['entries'][number]
/** Provider fixtures use the real v3 wire shape; old text fixtures stay replay-only. */
export function v3FixtureEntry<T extends {entryId: string; paragraphs: Array<{role: string; text: string; evidenceIds: string[]}>}>(entry: T, brief: Brief) {
  return {...entry, gapDecisions: [] as GapDecision[], coverage: FIVE_ELEMENTS.map(element => ({element,
    status: 'known' as const,
    evidenceIds: element === 'project' && brief.projectIdentity?.evidenceIds.length
      ? brief.projectIdentity.evidenceIds : [brief.facts[0].evidenceId],
  })), paragraphs: entry.paragraphs.map(paragraph => ({role: paragraph.role,
    segments: [{kind: 'fact' as const, text: paragraph.text, evidenceIds: paragraph.evidenceIds}]}))}
}

/** Production fixtures exercise the v4 wire shape; v3 remains a replay fixture. */
export function v4FixtureEntry<T extends {entryId: string; paragraphs: Array<{role: string; text: string; evidenceIds: string[]}>}>(entry: T, brief: Brief) {
  const {gapDecisions: _legacy, ...wire} = v3FixtureEntry(entry, brief)
  return {...wire, detailAssessments: [] as import('@/v5/writing/entry-skeleton').DetailAssessment[],
    uncertaintyResolutions: (brief.sourceUncertainties ?? []).map(signal => ({uncertaintyId: signal.uncertaintyId,
      action: 'use_safe_facts' as const, claimId: null, reason: 'safe_alternative' as const,
      explanation: '保留已有真实实践，省略尚需补证的结果。'}))}
}

export function v5FixtureEntry<T extends {entryId: string; paragraphs: Array<{role: string; text: string; evidenceIds: string[]}>}>(entry: T, brief: Brief) {
  const wire = v4FixtureEntry(entry, brief)
  return {...wire, coverage: wire.coverage.map(item => ({...item, answer: brief.facts[0].text,
    resultKind: item.element === 'result' ? 'deliverable' as const : 'not_applicable' as const})),
    paragraphs: wire.paragraphs.map((paragraph, index) => ({...paragraph, unitId: `${entry.entryId}:u${index}`})),
    actionReceipts: []}
}
