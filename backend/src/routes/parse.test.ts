import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { env } from '@/config/env'

const testUserId = '11111111-1111-4111-8111-111111111111'
const restRequests: Array<{
  options: unknown
  path: string
  requestOptions: unknown
}> = []
const authTokens: string[] = []
const workflowInputs: unknown[] = []

mock.module('@/repositories/supabase/client', () => ({
  SupabaseRestError: class SupabaseRestError extends Error {
    constructor(
      message: string,
      public readonly status: number,
      public readonly details?: unknown
    ) {
      super(message)
      this.name = 'SupabaseRestError'
    }
  },
  createSupabaseRestClient: (options: unknown) => ({
    request: async (path: string, requestOptions: unknown) => {
      restRequests.push({ options, path, requestOptions })
      return null
    },
  }),
  getSupabaseAuthUser: async (accessToken: string) => {
    authTokens.push(accessToken)
    return { id: testUserId, email: 'storage@example.com' }
  },
}))

mock.module('@/workflows/ocr-parse-workflow', () => ({
  OcrParseWorkflow: class OcrParseWorkflow {
    async run(input: unknown) {
      workflowInputs.push(input)
      return {
        provider: 'glm-ocr',
        fileName: 'resume.pdf',
        fileType: 'pdf',
        rawText: 'parsed resume',
        warnings: [],
      }
    }
  },
}))

const { parseRoutes } = await import('@/routes/parse')

describe('parseRoutes storage upload flow', () => {
  const originalFetch = globalThis.fetch
  const originalSupabaseUrl = env.SUPABASE_URL
  const originalPublishableKey = env.SUPABASE_PUBLISHABLE_KEY
  const originalStorageBucket = env.SUPABASE_STORAGE_BUCKET
  const originalAuthRequired = env.AUTH_REQUIRED

  beforeEach(() => {
    restRequests.length = 0
    authTokens.length = 0
    workflowInputs.length = 0

    env.SUPABASE_URL = 'https://example.supabase.co'
    env.SUPABASE_PUBLISHABLE_KEY = 'publishable-test-key'
    env.SUPABASE_STORAGE_BUCKET = 'user-files'
    env.AUTH_REQUIRED = true

    globalThis.fetch = mock(async () => new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46]), {
      status: 200,
      headers: { 'Content-Type': 'application/pdf' },
    })) as unknown as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    env.SUPABASE_URL = originalSupabaseUrl
    env.SUPABASE_PUBLISHABLE_KEY = originalPublishableKey
    env.SUPABASE_STORAGE_BUCKET = originalStorageBucket
    env.AUTH_REQUIRED = originalAuthRequired
  })

  test('downloads private storage object with user token and records user_files metadata', async () => {
    const response = await parseRoutes.handle(new Request('http://localhost/api/v1/parse/resume-file', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer user-access-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        file_name: 'resume.pdf',
        mime_type: 'application/pdf',
        storage_path: `${testUserId}/resume/resume.pdf`,
        size_bytes: 4,
      }),
    }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: {
        provider: 'glm-ocr',
        rawText: 'parsed resume',
      },
    })

    expect(authTokens).toEqual(['user-access-token'])
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://example.supabase.co/storage/v1/object/user-files/11111111-1111-4111-8111-111111111111/resume/resume.pdf',
      {
        headers: {
          apikey: 'publishable-test-key',
          Authorization: 'Bearer user-access-token',
        },
      },
    )
    expect(restRequests).toHaveLength(1)
    expect(restRequests[0]).toMatchObject({
      path: '/rest/v1/user_files',
      requestOptions: {
        method: 'POST',
        prefer: 'return=minimal',
        body: {
          user_id: testUserId,
          purpose: 'resume',
          bucket: 'user-files',
          storage_path: `${testUserId}/resume/resume.pdf`,
          original_file_name: 'resume.pdf',
          mime_type: 'application/pdf',
          size_bytes: 4,
        },
      },
    })
    expect(workflowInputs).toHaveLength(1)
    expect(workflowInputs[0]).toMatchObject({
      fileName: 'resume.pdf',
      mimeType: 'application/pdf',
      fileType: 'pdf',
      purpose: 'resume',
    })
  })

  test('allows unauthenticated inline resume parsing for Landing', async () => {
    const response = await parseRoutes.handle(new Request('http://localhost/api/v1/parse/resume-file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        file_name: 'resume.pdf',
        mime_type: 'application/pdf',
        content_base64: 'JVBERg==',
        landing: true,
      }),
    }))

    expect(response.status).not.toBe(401)
    expect(workflowInputs).toHaveLength(1)
  })
})
