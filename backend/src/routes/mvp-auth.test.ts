import { describe, expect, spyOn, test } from 'bun:test'
import { mvpRoutes } from '@/routes/mvp'
import { ResumeOptimizationWorkflow } from '@/workflows/resume-optimization-workflow'
import { ResumeQuotaError } from '@/services/resume-quota'

describe('mvpRoutes auth guard', () => {
  test('returns 429 when analysis completion encounters an exhausted quota', async () => {
    const run = spyOn(ResumeOptimizationWorkflow.prototype, 'run').mockImplementation(async input => {
      expect(input.onAnalysisSucceeded).toBeFunction()
      expect(input.output_language).toBe('en-US')
      throw new ResumeQuotaError(3, 3)
    })
    try {
      const response = await mvpRoutes.handle(new Request('http://localhost/api/v1/mvp/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resume_markdown: 'source resume markdown', jd_text: 'target job description', output_language: 'en-US' }),
      }))
      expect(response.status).toBe(429)
      await expect(response.json()).resolves.toMatchObject({
        success: false,
        error: { code: 'RESUME_DAILY_LIMIT_REACHED', details: { limit: 3, used: 3 } },
      })
    } finally {
      run.mockRestore()
    }
  })

  test('keeps health public', async () => {
    const response = await mvpRoutes.handle(new Request('http://localhost/api/v1/mvp/health'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ status: 'ok' })
  })

  test('rejects malformed authorization headers on protected routes', async () => {
    const response = await mvpRoutes.handle(new Request('http://localhost/api/v1/mvp/dashboard', {
      headers: { Authorization: 'Token invalid-token' },
    }))

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: { code: 'INVALID_AUTHORIZATION_HEADER' },
    })
  })
})
