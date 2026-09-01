import type { LlmProvider } from '@/providers/llm-provider'
import { runV5StructuredStage } from '@/v5/stage-runner'
import type { BlindABEvaluation, GeneratedResumeArtifact, JobRequirementBundle, ResumeEvidenceBundle } from '@/v5/types'
import { V5_SCHEMA_VERSION, V5_WORKFLOW_VERSION } from '@/v5/types'

export interface DoubleOrderAbInput {
  runId: string
  resumeEvidenceBundle: ResumeEvidenceBundle
  jobRequirementBundle: JobRequirementBundle
  candidateLeft: GeneratedResumeArtifact
  candidateRight: GeneratedResumeArtifact
}

export interface DoubleOrderAbResult {
  forward: BlindABEvaluation
  reverse: BlindABEvaluation
  normalizedForwardWinner: 'left' | 'right' | 'tie'
  normalizedReverseWinner: 'left' | 'right' | 'tie'
  orderConsistent: boolean
  absoluteGateConsistent: boolean
  scoreDriftMax: number
}

function envelope(input: DoubleOrderAbInput, first: GeneratedResumeArtifact, second: GeneratedResumeArtifact) {
  return {
    schemaVersion: V5_SCHEMA_VERSION,
    runId: input.runId,
    workflowVersion: V5_WORKFLOW_VERSION,
    payload: {
      resumeEvidenceBundle: input.resumeEvidenceBundle,
      jobRequirementBundle: input.jobRequirementBundle,
      candidates: [
        { candidateId: 'A', markdown: first.markdown },
        { candidateId: 'B', markdown: second.markdown },
      ],
    },
  }
}

function normalizedWinner(result: BlindABEvaluation, reversed: boolean) {
  if (result.pairwise.winner === 'tie') return 'tie' as const
  const firstWon = result.pairwise.winner === 'A'
  if (reversed) return firstWon ? 'right' as const : 'left' as const
  return firstWon ? 'left' as const : 'right' as const
}

function scoreTotal(result: BlindABEvaluation, candidateId: 'A' | 'B') {
  const item = result.evaluations.find(candidate => candidate.candidateId === candidateId)
  return item ? Object.values(item.dimensions).reduce((sum, score) => sum + score, 0) : 0
}

export async function runDoubleOrderBlindAb(
  input: DoubleOrderAbInput,
  options: { provider?: LlmProvider; maxAcceptedScoreDrift?: number } = {}
): Promise<DoubleOrderAbResult> {
  const [forward, reverse] = await Promise.all([
    runV5StructuredStage<BlindABEvaluation>({
      component: 'P12',
      envelope: envelope(input, input.candidateLeft, input.candidateRight),
      options: { provider: options.provider },
    }).then(result => result.value),
    runV5StructuredStage<BlindABEvaluation>({
      component: 'P12',
      envelope: envelope(input, input.candidateRight, input.candidateLeft),
      options: { provider: options.provider },
    }).then(result => result.value),
  ])

  const normalizedForwardWinner = normalizedWinner(forward, false)
  const normalizedReverseWinner = normalizedWinner(reverse, true)
  const forwardGates = {
    left: forward.evaluations.find(item => item.candidateId === 'A')?.absoluteGate,
    right: forward.evaluations.find(item => item.candidateId === 'B')?.absoluteGate,
  }
  const reverseGates = {
    left: reverse.evaluations.find(item => item.candidateId === 'B')?.absoluteGate,
    right: reverse.evaluations.find(item => item.candidateId === 'A')?.absoluteGate,
  }
  const scoreDriftMax = Math.max(
    Math.abs(scoreTotal(forward, 'A') - scoreTotal(reverse, 'B')),
    Math.abs(scoreTotal(forward, 'B') - scoreTotal(reverse, 'A'))
  )
  const absoluteGateConsistent = forwardGates.left === reverseGates.left && forwardGates.right === reverseGates.right
  const orderConsistent = normalizedForwardWinner === normalizedReverseWinner
    && absoluteGateConsistent
    && scoreDriftMax <= (options.maxAcceptedScoreDrift ?? 8)

  return {
    forward,
    reverse,
    normalizedForwardWinner,
    normalizedReverseWinner,
    orderConsistent,
    absoluteGateConsistent,
    scoreDriftMax,
  }
}
