import type { ResumeAgentState, V5DeliveryDiagnostics, ValidationIssue } from '@/v5/types'

export class V5WorkflowBlockedError extends Error {
  readonly code: string
  readonly state: ResumeAgentState
  readonly issues: ValidationIssue[]
  readonly retryable: boolean
  readonly httpStatus: number
  /** 上游 Provider 的 HTTP 状态，仅用于诊断，不包含响应正文或凭据。 */
  readonly providerStatus?: number
  runId?: string
  deliveryDiagnostics?: V5DeliveryDiagnostics

  constructor(input: {
    code: string
    state: ResumeAgentState
    message: string
    issues?: ValidationIssue[]
    retryable?: boolean
    httpStatus?: number
    providerStatus?: number
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
    this.providerStatus = input.providerStatus
  }
}
