import { createHash } from 'node:crypto'
import type { CanonicalSourceDocument, EvidenceAtom, SourceBlock } from '@/v5/types'

// Tabs can be table delimiters; form feeds and Unicode controls are not line
// padding. Bound stored separators, not source distance in lieu of proof.
export const MAX_SOURCE_LAYOUT_SEPARATOR_LENGTH = 256
export function isSourceLayoutWhitespace(separator: string) {
  return separator.length > 1
    && separator.length <= MAX_SOURCE_LAYOUT_SEPARATOR_LENGTH
    && /^[ \u00a0\u3000]*\n(?:[ \u00a0\u3000]*\n)*[ \u00a0\u3000]*$/u.test(separator)
}

export function isPlainSourceContinuationBlock(text: string) {
  return !/[|\t<>\f\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/u.test(text)
    && !/^\s*(?:#{1,6}\s|[-*+]\s|\d+[.)]\s)/u.test(text)
}

function binding(parts: unknown[]) {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex')
}

export function sourceLineBlockBinding(
  documentHash: string, previous: SourceBlock, current: SourceBlock, separator: string
) {
  return binding(['source-line-boundary-v1', documentHash,
    previous.sourceBlockId, previous.canonicalStart, previous.canonicalEnd, previous.text,
    current.sourceBlockId, current.canonicalStart, current.canonicalEnd, current.text, separator])
}

function sourceLineEvidenceBinding(previous: EvidenceAtom, current: EvidenceAtom, separator: string) {
  return binding(['source-line-evidence-v1', previous.sourceDocumentHash, previous.sourceScopeId,
    previous.evidenceId, previous.sourceBlockId, previous.sourceSpan.start, previous.sourceSpan.end, previous.verbatimText,
    current.sourceDocumentHash, current.sourceScopeId,
    current.evidenceId, current.sourceBlockId, current.sourceSpan.start, current.sourceSpan.end, current.verbatimText,
    separator])
}

/** Bind full-block source proofs after V01. No candidate field is copied. */
export function bindSourceLineContinuations(document: CanonicalSourceDocument, atoms: EvidenceAtom[]) {
  if (!document.sourceLineContinuations?.length) return
  const blockById = new Map(document.blocks.map(block => [block.sourceBlockId, block]))
  const atomsByBlock = new Map<string, EvidenceAtom[]>()
  for (const atom of atoms) atomsByBlock.set(atom.sourceBlockId, [...(atomsByBlock.get(atom.sourceBlockId) ?? []), atom])
  for (const proof of document.sourceLineContinuations) {
    const previousBlock = blockById.get(proof.previousBlockId)
    const currentBlock = blockById.get(proof.currentBlockId)
    const previousAtoms = atomsByBlock.get(proof.previousBlockId)
    const currentAtoms = atomsByBlock.get(proof.currentBlockId)
    if (!previousBlock || !currentBlock || previousAtoms?.length !== 1 || currentAtoms?.length !== 1) continue
    const previousOrdinal = /^B(\d+)$/.exec(previousBlock.sourceBlockId)?.[1]
    const currentOrdinal = /^B(\d+)$/.exec(currentBlock.sourceBlockId)?.[1]
    if (previousOrdinal === undefined || currentOrdinal === undefined || Number(currentOrdinal) !== Number(previousOrdinal) + 1
      || !isSourceLayoutWhitespace(proof.separator)
      || currentBlock.canonicalStart - previousBlock.canonicalEnd !== proof.separator.length
      || previousBlock.inputRiskFlags.length || currentBlock.inputRiskFlags.length
      || !isPlainSourceContinuationBlock(previousBlock.text) || !isPlainSourceContinuationBlock(currentBlock.text)
      || sourceLineBlockBinding(document.sha256, previousBlock, currentBlock, proof.separator) !== proof.binding) continue
    const previous = previousAtoms[0]
    const current = currentAtoms[0]
    const fullBlock = (atom: EvidenceAtom, block: SourceBlock) => atom.sourceDocumentHash === document.sha256
      && atom.sourceSpan.start === block.canonicalStart && atom.sourceSpan.end === block.canonicalEnd
      && atom.verbatimText === block.text
    if (!fullBlock(previous, previousBlock) || !fullBlock(current, currentBlock)
      || previous.sourceScopeId !== current.sourceScopeId) continue
    current.sourceContinuation = {
      previousEvidenceId: previous.evidenceId,
      separator: proof.separator,
      binding: sourceLineEvidenceBinding(previous, current, proof.separator),
    }
  }
}

export function hasProvenSourceLayoutSeparator(previous: EvidenceAtom, current: EvidenceAtom) {
  const proof = current.sourceContinuation
  return Boolean(proof
    && proof.previousEvidenceId === previous.evidenceId
    && isSourceLayoutWhitespace(proof.separator)
    && current.sourceSpan.start - previous.sourceSpan.end === proof.separator.length
    && isPlainSourceContinuationBlock(previous.verbatimText) && isPlainSourceContinuationBlock(current.verbatimText)
    && proof.binding === sourceLineEvidenceBinding(previous, current, proof.separator))
}
