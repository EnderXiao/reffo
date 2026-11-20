import { DashboardAccessError } from '@/auth/dashboard-access'
import { RequestAuthError } from '@/auth/request-context'
import { reportError } from '@/shared/error-reporter'
import { logger } from '@/shared/logger'

export interface HttpErrorHandlerContext {
  code: string | number
  error: unknown
  set: { status?: number | string }
  request: { method: string }
  path: string
}

/**
 * 全局 HTTP 错误处理：
 * - 客户端鉴权失败（RequestAuthError）与后台权限错误（DashboardAccessError）是客户端状态问题，
 *   按原状态码返回、不写异常表，避免过期会话轮询灌满 error_events。
 * - VALIDATION/NOT_FOUND 及未知错误维持原有上报语义。
 */
export function httpErrorHandler({code, error, set, request, path}: HttpErrorHandlerContext) {
  if (error instanceof RequestAuthError) {
    set.status = error.status
    return {success: false, error: {code: error.code, message: error.message}}
  }

  if (error instanceof DashboardAccessError) {
    set.status = error.status
    return {success: false, error: {code: error.code, message: error.message}}
  }

  const status = code === 'VALIDATION' ? 400 : code === 'NOT_FOUND' ? 404 : 500
  reportError({path, method: request.method, status, errorCode: String(code), error})
  logger.error('Global error handler:', error)

  if (code === 'VALIDATION') {
    set.status = 400
    return {
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: '请求参数验证失败',
      },
    }
  }

  if (code === 'NOT_FOUND') {
    set.status = 404
    return {
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: '请求的资源不存在',
      },
    }
  }

  set.status = 500
  return {
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: '服务暂时不可用，请稍后重试',
    },
  }
}
