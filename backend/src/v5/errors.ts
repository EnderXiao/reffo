import type { ResumeAgentState, V5DeliveryDiagnostics, ValidationIssue } from '@/v5/types'

export class V5WorkflowBlockedError extends Error {
  readonly code: string
  readonly state: ResumeAgentState
  readonly issues: ValidationIssue[]
  readonly retryable: boolean
  readonly httpStatus: number
  runId?: string
  deliveryDiagnostics?: V5DeliveryDiagnostics

  constructor(input: {
    code: string
    state: ResumeAgentState
    message: string
    issues?: ValidationIssue[]
    retryable?: boolean
    httpStatus?: number
  }) {
    super(input.message)
    this.name = 'V5WorkflowBlockedError'
    this.code = input.code
    this.state = input.state
    this.issues = input.issues ?? []
    this.retryable = input.retryable ?? false
    this.httpStatus = input.httpStatus ?? (
      input.state === 'provider_failure'
        ? 502
        : input.state === 'workflow_failure' ? 500 : 422
    )
  }
}
