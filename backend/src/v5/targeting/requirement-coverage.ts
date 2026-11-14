import type { CanonicalSourceDocument, JobExtractionCandidate, ValidationIssue } from '@/v5/types'
import { writingIssue } from '@/v5/writing/facts'

/** Block coverage is provenance bookkeeping; it cannot certify independent conditions were extracted. */
export function inspectRequirementSemanticCoverage(document: CanonicalSourceDocument, candidate: JobExtractionCandidate): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  for (const block of document.blocks) {
    const requirements = candidate.requirementCandidates.filter(item => item.sourceBlockId === block.sourceBlockId)
    if (!requirements.length || block.inputRiskFlags.length) continue
    const compoundQualification = /本科|学士|硕士|博士|大专/u.test(block.text)
      && /\d+\s*年/u.test(block.text) && /优先|加分/u.test(block.text)
    const separateRequired = (['education', 'experience'] as const).every(category => requirements.some(item => item.category === category
      && !(category === 'education' && /\d+\s*年/u.test(item.verbatimText))
      && !(category === 'experience' && /本科|学士|硕士|博士|大专/u.test(item.verbatimText))
      && !/优先|加分/u.test(item.verbatimText)))
    const separatePreferred = requirements.some(item => /优先|加分/u.test(item.verbatimText)
      && !/本科|学士|硕士|博士|大专|\d+\s*年/u.test(item.verbatimText))
    if (compoundQualification && (!separateRequired || !separatePreferred)) {
      issues.push(writingIssue('JD_COMPOSITE_QUALIFICATION_UNSPLIT', block.sourceBlockId, [],
        '同一原文块的学历、年限和优先经验须拆成可独立判断的要求，分别保留精确quote/span及强度；不能用整块覆盖代替语义覆盖。'))
    }
    if (requirements.some(item => /(?:^|\n)\s*\d+[.、)）][\s\S]+(?:\n|\s)\d+[.、)）]/u.test(item.verbatimText))) {
      issues.push(writingIssue('JD_NUMBERED_REQUIREMENTS_MERGED', block.sourceBlockId, [],
        '来源保留多个独立编号，请分别提取其要求及精确来源范围；不因OCR把多条并成一个block而整体判断。'))
    }
  }
  return issues
}
