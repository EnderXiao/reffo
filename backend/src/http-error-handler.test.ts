import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { DashboardAccessError } from '@/auth/dashboard-access'
import { RequestAuthError } from '@/auth/request-context'

const reportErrorMock = mock((_input: unknown) => {})
const loggerMock = { error: mock(() => {}) }

mock.module('@/shared/error-reporter', () => ({ reportError: reportErrorMock }))
mock.module('@/shared/logger', () => ({ logger: loggerMock }))

const { httpErrorHandler } = await import('@/http-error-handler')

function context(error: unknown) {
  return {
    code: 'UNKNOWN',
    error,
    set: {} as { status?: number | string },
    request: { method: 'GET' },
    path: '/api/v1/generation-jobs/events',
  }
}

describe('httpErrorHandler', () => {
  beforeEach(() => {
    reportErrorMock.mockClear()
    loggerMock.error.mockClear()
  })

  test('RequestAuthError 按 401 返回且不写异常表', () => {
    const ctx = context(new RequestAuthError('INVALID_ACCESS_TOKEN', '登录状态无效，请重新登录'))
    const result = httpErrorHandler(ctx)
    expect(ctx.set.status).toBe(401)
    expect(result).toEqual({
      success: false,
      error: { code: 'INVALID_ACCESS_TOKEN', message: '登录状态无效，请重新登录' },
    })
    expect(reportErrorMock).not.toHaveBeenCalled()
  })

  test('DashboardAccessError 按原状态返回且不写异常表', () => {
    const ctx = context(new DashboardAccessError('DASHBOARD_FORBIDDEN', '当前账号没有管理后台权限', 403))
    const result = httpErrorHandler(ctx)
    expect(ctx.set.status).toBe(403)
    expect(result).toEqual({
      success: false,
      error: { code: 'DASHBOARD_FORBIDDEN', message: '当前账号没有管理后台权限' },
    })
    expect(reportErrorMock).not.toHaveBeenCalled()
  })

  test('VALIDATION 返回 400 并上报异常', () => {
    const ctx = context(new Error('bad input'))
    ctx.code = 'VALIDATION'
    const result = httpErrorHandler(ctx)
    expect(ctx.set.status).toBe(400)
    expect(result).toMatchObject({ success: false, error: { code: 'VALIDATION_ERROR' } })
    expect(reportErrorMock).toHaveBeenCalledTimes(1)
    expect(reportErrorMock.mock.calls[0][0]).toMatchObject({
      path: '/api/v1/generation-jobs/events',
      method: 'GET',
      status: 400,
      errorCode: 'VALIDATION',
    })
  })

  test('NOT_FOUND 返回 404 并上报异常', () => {
    const ctx = context(new Error('not found'))
    ctx.code = 'NOT_FOUND'
    const result = httpErrorHandler(ctx)
    expect(ctx.set.status).toBe(404)
    expect(result).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } })
    expect(reportErrorMock).toHaveBeenCalledTimes(1)
  })

  test('未知错误返回 500 并上报异常', () => {
    const ctx = context(new Error('boom'))
    const result = httpErrorHandler(ctx)
    expect(ctx.set.status).toBe(500)
    expect(result).toEqual({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: '服务暂时不可用，请稍后重试' },
    })
    expect(reportErrorMock).toHaveBeenCalledTimes(1)
    expect(reportErrorMock.mock.calls[0][0]).toMatchObject({ status: 500, errorCode: 'UNKNOWN' })
    expect(loggerMock.error).toHaveBeenCalled()
  })
})
