import type { ProcessRequest, ProcessResult } from '../types/mvp'

type ProcessSuccessResponse = {
  success: true
  data: ProcessResult
}

type ProcessErrorResponse = {
  success: false
  error?: {
    message?: string
  }
}

type ProcessResponse = ProcessSuccessResponse | ProcessErrorResponse

const MVP_PROCESS_ENDPOINT = '/api/v1/mvp/process'

export async function processResume(request: ProcessRequest): Promise<ProcessResult> {
  const response = await fetch(MVP_PROCESS_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  })

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`)
  }

  const data = (await response.json()) as ProcessResponse

  if (!data.success) {
    throw new Error(data.error?.message || '处理失败')
  }

  return data.data
}
