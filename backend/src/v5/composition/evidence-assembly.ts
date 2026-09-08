import type { EvidenceAtom, ResumeEvidenceBundle, V5ResumePlan } from '@/v5/types'
import { areCanonicalAdjacentSourceAtoms, businessSourceContinuationGroups, hasCanonicalSourceLineSeparator } from '@/v5/composition/source-continuation'

const BUSINESS_CLAIM_TYPES = new Set<EvidenceAtom['claimType']>([
  'responsibility',
  'action',
  'deliverable',
  'result',
])

const METADATA_CLAIM_TYPES = new Set<EvidenceAtom['claimType']>([
  'identity',
  'timeline',
  'skill',
  'education',
])

const SOURCE_BLOCK_PATTERN = /^B(\d+)$/
const TERMINAL_PUNCTUATION_PATTERN = /[。！？.!?；;：:]$/u
const MAX_ASSEMBLY_MEMBERS = 3

export type EvidenceAssemblyKind = 'source_concat' | 'companion_semicolon' | 'companion_concat'

/**
 * Internal, server-derived grouping. It is deliberately not part of the
 * public ResumePlan or P06D response contracts.
 */
export interface EvidenceAssembly {
  kind: EvidenceAssemblyKind
  joiner: 'source_concat' | 'semicolon'
  anchorEvidenceId: string
  plannedEvidenceIds: string[]
  memberEvidenceIds: string[]
  sourceDocumentHash: string
  sourceScopeId: string
  firstSourceBlockId: string
  lastSourceBlockId: string
}

function sourceBlockOrdinal(sourceBlockId: string) {
  const match = SOURCE_BLOCK_PATTERN.exec(sourceBlockId)
  return match ? Number(match[1]) : null
}

function hasValidSourceCoordinates(atom: EvidenceAtom) {
  return Boolean(
    atom.sourceDocumentHash.trim()
    && atom.sourceScopeId.trim()
    && sourceBlockOrdinal(atom.sourceBlockId) !== null
    && Number.isSafeInteger(atom.sourceSpan.start)
    && Number.isSafeInteger(atom.sourceSpan.end)
    && atom.sourceSpan.start >= 0
    && atom.sourceSpan.end > atom.sourceSpan.start
    && atom.verbatimText.trim()
  )
}

function isCleanSourceAtom(atom: EvidenceAtom) {
  return atom.status === 'source_supported'
    && atom.riskFlags.length === 0
    && hasValidSourceCoordinates(atom)
}

function canonicalAtomOrder(left: EvidenceAtom, right: EvidenceAtom) {
  const leftOrdinal = sourceBlockOrdinal(left.sourceBlockId) ?? Number.MAX_SAFE_INTEGER
  const rightOrdinal = sourceBlockOrdinal(right.sourceBlockId) ?? Number.MAX_SAFE_INTEGER
  return left.sourceDocumentHash.localeCompare(right.sourceDocumentHash)
    || left.sourceScopeId.localeCompare(right.sourceScopeId)
    || leftOrdinal - rightOrdinal
    || left.sourceSpan.start - right.sourceSpan.start
    || left.sourceSpan.end - right.sourceSpan.end
    || left.sourceBlockId.localeCompare(right.sourceBlockId)
    || left.evidenceId.localeCompare(right.evidenceId)
}

function isCanonicalLineNeighbor(left: EvidenceAtom, right: EvidenceAtom) {
  const leftOrdinal = sourceBlockOrdinal(left.sourceBlockId)
  const rightOrdinal = sourceBlockOrdinal(right.sourceBlockId)
  return leftOrdinal !== null
    && rightOrdinal !== null
    && left.sourceDocumentHash === right.sourceDocumentHash
    && left.sourceScopeId === right.sourceScopeId
    && rightOrdinal === leftOrdinal + 1
    && hasCanonicalSourceLineSeparator(left, right)
    && !TERMINAL_PUNCTUATION_PATTERN.test(left.verbatimText.trim())
}

function selectedBusinessEvidenceIds(resume: ResumeEvidenceBundle, plan: V5ResumePlan) {
  const evidence = new Map(resume.evidenceAtoms.map(atom => [atom.evidenceId, atom]))
  const allSelectedIds = new Set(plan.scopePlans.flatMap(scopePlan => scopePlan.selectedEvidenceIds))
  const selectedBusinessIds = new Set<string>()
  for (const scopePlan of plan.scopePlans) {
    for (const evidenceId of scopePlan.selectedEvidenceIds) {
      const atom = evidence.get(evidenceId)
      if (
        atom
        && atom.sourceScopeId === scopePlan.scopeId
        && BUSINESS_CLAIM_TYPES.has(atom.claimType)
      ) selectedBusinessIds.add(evidenceId)
    }
  }
  return { allSelectedIds, selectedBusinessIds }
}

function duplicateValues(values: string[]) {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value)
    seen.add(value)
  }
  return duplicates
}

function canonicalRuns(atoms: EvidenceAtom[]) {
  const duplicateEvidenceIds = duplicateValues(atoms.map(atom => atom.evidenceId))
  const duplicateBlockKeys = duplicateValues(atoms.map(atom => (
    [atom.sourceDocumentHash, atom.sourceScopeId, atom.sourceBlockId].join('\u0000')
  )))
  const isAmbiguous = (atom: EvidenceAtom) => duplicateEvidenceIds.has(atom.evidenceId)
    || duplicateBlockKeys.has([
      atom.sourceDocumentHash,
      atom.sourceScopeId,
      atom.sourceBlockId,
    ].join('\u0000'))

  const sorted = [...atoms].sort(canonicalAtomOrder)
  const runs: EvidenceAtom[][] = []
  let current: EvidenceAtom[] = []
  for (const atom of sorted) {
    const previous = current.at(-1)
    if (
      previous
      && !isAmbiguous(previous)
      && !isAmbiguous(atom)
      && isCanonicalLineNeighbor(previous, atom)
    ) {
      current.push(atom)
      continue
    }
    if (current.length > 1) runs.push(current)
    current = [atom]
  }
  if (current.length > 1) runs.push(current)
  return runs
}

/**
 * Derives non-overlapping source assemblies from the complete evidence
 * catalog. Maximal runs are evaluated as a unit; oversized or partially unsafe
 * runs are rejected rather than split into a convenient-looking subgroup.
 */
export function deriveEvidenceAssemblies(
  resume: ResumeEvidenceBundle,
  plan: V5ResumePlan
): EvidenceAssembly[] {
  const { allSelectedIds, selectedBusinessIds } = selectedBusinessEvidenceIds(resume, plan)
  const assemblies: EvidenceAssembly[] = []
  for (const group of businessSourceContinuationGroups(resume.evidenceAtoms)) {
    if (group[0].sourceDocumentHash !== resume.sourceDocument.sha256
      || group.some(atom => !hasValidSourceCoordinates(atom))
      || !selectedBusinessIds.has(group[0].evidenceId)
      || group.slice(1).some(atom => allSelectedIds.has(atom.evidenceId))) continue
    assemblies.push({
      kind: 'companion_concat', joiner: 'source_concat', anchorEvidenceId: group[0].evidenceId,
      plannedEvidenceIds: [group[0].evidenceId], memberEvidenceIds: group.map(atom => atom.evidenceId),
      sourceDocumentHash: group[0].sourceDocumentHash, sourceScopeId: group[0].sourceScopeId,
      firstSourceBlockId: group[0].sourceBlockId, lastSourceBlockId: group.at(-1)!.sourceBlockId,
    })
  }
  const completedMembers = new Set(assemblies.flatMap(assembly => assembly.memberEvidenceIds))

  for (const run of canonicalRuns(resume.evidenceAtoms)) {
    if (run.some(atom => completedMembers.has(atom.evidenceId))) continue
    if (run.length > MAX_ASSEMBLY_MEMBERS) continue
    if (run.some(atom => (
      atom.sourceDocumentHash !== resume.sourceDocument.sha256
      || !isCleanSourceAtom(atom)
      || METADATA_CLAIM_TYPES.has(atom.claimType)
    ))) continue

    const plannedBusinessAtoms = run.filter(atom => selectedBusinessIds.has(atom.evidenceId))
    const allMembersArePlannedBusiness = plannedBusinessAtoms.length === run.length
      && run.every(atom => BUSINESS_CLAIM_TYPES.has(atom.claimType))

    if (allMembersArePlannedBusiness) {
      if (!areCanonicalAdjacentSourceAtoms(run)) continue
      assemblies.push({
        kind: 'source_concat',
        joiner: 'source_concat',
        anchorEvidenceId: run[0].evidenceId,
        plannedEvidenceIds: run.map(atom => atom.evidenceId),
        memberEvidenceIds: run.map(atom => atom.evidenceId),
        sourceDocumentHash: run[0].sourceDocumentHash,
        sourceScopeId: run[0].sourceScopeId,
        firstSourceBlockId: run[0].sourceBlockId,
        lastSourceBlockId: run.at(-1)!.sourceBlockId,
      })
      continue
    }

    if (
      plannedBusinessAtoms.length !== 1
      || run.some(atom => (
        atom.evidenceId !== plannedBusinessAtoms[0].evidenceId
        && (atom.claimType !== 'other' || allSelectedIds.has(atom.evidenceId))
      ))
    ) continue

    assemblies.push({
      kind: 'companion_semicolon',
      joiner: 'semicolon',
      anchorEvidenceId: plannedBusinessAtoms[0].evidenceId,
      plannedEvidenceIds: [plannedBusinessAtoms[0].evidenceId],
      memberEvidenceIds: run.map(atom => atom.evidenceId),
      sourceDocumentHash: run[0].sourceDocumentHash,
      sourceScopeId: run[0].sourceScopeId,
      firstSourceBlockId: run[0].sourceBlockId,
      lastSourceBlockId: run.at(-1)!.sourceBlockId,
    })
  }

  return assemblies
}
