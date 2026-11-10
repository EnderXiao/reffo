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
