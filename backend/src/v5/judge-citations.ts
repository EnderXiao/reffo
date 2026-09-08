import type { BlindABEvaluation } from '@/v5/types'

const FINDING_FIELDS = ['unsupportedClaims', 'attributionErrors', 'emptyScopes', 'internalAuditLeaks'] as const
export class V5JudgeCitationError extends Error {
  readonly code = 'V5_JUDGE_CITATION_INVALID'
  constructor(readonly locations: Array<{ candidateId: 'A' | 'B'; field: string; index: number }>) {
    super('离线评审的事实指控缺少可定位正文摘录；评测无效，不代表候选简历事实错误。')
    this.name = 'V5JudgeCitationError'
  }
}
/** Verifies quotation existence only, not the truth of the judge's interpretation. */
export function validateJudgeCitations(result: BlindABEvaluation, candidates: Array<{ candidateId: 'A' | 'B'; markdown: string }>) {
  const documents = new Map(candidates.map(candidate => [candidate.candidateId, candidate.markdown.normalize('NFC')]))
  const invalid: V5JudgeCitationError['locations'] = []
  for (const evaluation of result.evaluations) {
    for (const field of FINDING_FIELDS) {
      evaluation[field].forEach((finding, index) => {
        const quote = finding.match(/^\s*「([^「」\r\n]{2,60})」/u)?.[1]
        if (!quote || !documents.get(evaluation.candidateId)?.includes(quote.normalize('NFC'))) {
          invalid.push({ candidateId: evaluation.candidateId, field, index })
        }
      })
    }
  }
  if (invalid.length) throw new V5JudgeCitationError(invalid)
}
