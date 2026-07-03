import {feedback} from './feedback';

/**
 * 错误类型枚举
 *
 * 定义应用中可能出现的错误类型
 */
export enum ErrorType {
  /** 网络错误 */
  NETWORK_ERROR = 'NETWORK_ERROR',
  /** 请求超时 */
  TIMEOUT = 'TIMEOUT',
  /** API 错误 */
  API_ERROR = 'API_ERROR',
  /** 验证错误 */
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  /** 业务错误 */
  BUSINESS_ERROR = 'BUSINESS_ERROR',
  /** 未知错误 */
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}

/**
 * 应用级错误类
 *
 * 封装应用中的错误信息，提供统一的错误处理接口
 *
 * @example
 * ```typescript
 * throw new AppError(
 *   ErrorType.VALIDATION_ERROR,
 *   '简历内容不能为空',
 *   { field: 'resume' }
 * )
 * ```
 */
export class AppError extends Error {
  /**
   * 创建应用错误实例
   *
   * @param type 错误类型
   * @param message 错误消息
   * @param details 错误详情（可选）
   */
  constructor(
    public type: ErrorType,
    message: string,
    public details?: any,
  ) {
    super(message);
    this.name = 'AppError';

    // 保持正确的原型链（TypeScript 继承 Error 的问题）
    Object.setPrototypeOf(this, AppError.prototype);
  }

  /**
   * 获取友好的错误消息
   *
   * @returns 用户友好的错误提示
   */
  getUserMessage(): string {
    return getErrorMessage(this);
  }

  /**
   * 转换为 JSON 对象
   *
   * @returns 错误的 JSON 表示
   */
  toJSON() {
    return {
      name: this.name,
      type: this.type,
      message: this.message,
      details: this.details,
    };
  }
}

/**
 * 错误消息映射表
 *
 * 将错误类型映射到用户友好的提示消息
 */
const ERROR_MESSAGES: Record<ErrorType, string> = {
  [ErrorType.NETWORK_ERROR]: '网络连接失败，请检查网络设置',
  [ErrorType.TIMEOUT]: '网络请求超时，请检查网络连接后重试',
  [ErrorType.API_ERROR]: '服务器错误，请稍后重试',
  [ErrorType.VALIDATION_ERROR]: '输入数据不合法，请检查后重试',
  [ErrorType.BUSINESS_ERROR]: '操作失败，请稍后重试',
  [ErrorType.UNKNOWN_ERROR]: '操作失败，请稍后重试',
};

/**
 * 获取友好的错误消息
 *
 * 根据错误对象返回用户友好的提示消息
 *
 * @param error 错误对象
 * @returns 用户友好的错误消息
 *
 * @example
 * ```typescript
 * try {
 *   await apiCall()
 * } catch (error) {
 *   const message = getErrorMessage(error)
 *   console.log(message) // "网络连接失败，请检查网络设置"
 * }
 * ```
 *
 * **Validates: Requirements 7.3, 7.4**
 */
export function getErrorMessage(error: unknown): string {
  // AppError 类型
  if (error instanceof AppError) {
    // 如果有自定义消息，优先使用
    if (error.message && error.message !== ERROR_MESSAGES[error.type]) {
      return error.message;
    }
    return ERROR_MESSAGES[error.type];
  }

  // 标准 Error 类型
  if (error instanceof Error) {
    // 检查是否是网络相关错误
    if (error.message.includes('timeout')) {
      return ERROR_MESSAGES[ErrorType.TIMEOUT];
    }
    if (
      error.message.includes('network') ||
      error.message.includes('连接') ||
      error.message.includes('fail')
    ) {
      return ERROR_MESSAGES[ErrorType.NETWORK_ERROR];
    }
    // 返回原始错误消息
    return error.message;
  }

  // 字符串类型
  if (typeof error === 'string') {
    return error;
  }

  // 对象类型（可能是 API 错误响应）
  if (error && typeof error === 'object') {
    const err = error as any;

    // 检查是否有 message 字段
    if (err.message && typeof err.message === 'string') {
      return err.message;
    }

    // 检查是否有 error.message 字段（API 响应格式）
    if (err.error && err.error.message) {
      return err.error.message;
    }

    // 检查是否有 errMsg 字段（Taro 错误格式）
    if (err.errMsg && typeof err.errMsg === 'string') {
      if (err.errMsg.includes('timeout')) {
        return ERROR_MESSAGES[ErrorType.TIMEOUT];
      }
      if (err.errMsg.includes('fail')) {
        return ERROR_MESSAGES[ErrorType.NETWORK_ERROR];
      }
      return err.errMsg;
    }
  }

  // 未知错误
  return ERROR_MESSAGES[ErrorType.UNKNOWN_ERROR];
}

/**
 * 统一错误处理函数
 *
 * 将各种类型的错误转换为 AppError，并记录日志
 *
 * @param error 原始错误对象
 * @param context 错误上下文（可选，用于日志记录）
 * @returns AppError 实例
 *
 * @example
 * ```typescript
 * try {
 *   await apiCall()
 * } catch (error) {
 *   const appError = handleError(error, { action: 'analyzeResume' })
 *   showErrorToast(appError)
 * }
 * ```
 *
 * **Validates: Requirements 7.3, 7.4**
 */
export function handleError(error: unknown, context?: any): AppError {
  // 已经是 AppError，直接返回
  if (error instanceof AppError) {
    console.error('[AppError]', {
      type: error.type,
      message: error.message,
      details: error.details,
      context,
    });
    return error;
  }

  // 标准 Error 类型
  if (error instanceof Error) {
    let errorType = ErrorType.UNKNOWN_ERROR;

    // 根据错误消息判断类型
    if (error.message.includes('timeout')) {
      errorType = ErrorType.TIMEOUT;
    } else if (
      error.message.includes('network') ||
      error.message.includes('连接') ||
      error.message.includes('fail')
    ) {
      errorType = ErrorType.NETWORK_ERROR;
    } else if (
      error.message.includes('验证') ||
      error.message.includes('不合法')
    ) {
      errorType = ErrorType.VALIDATION_ERROR;
    }

    const appError = new AppError(errorType, error.message, {
      originalError: error,
      context,
    });

    console.error('[Error]', {
      type: appError.type,
      message: appError.message,
      originalError: error,
      context,
    });

    return appError;
  }

  // 对象类型（可能是 API 错误响应或 Taro 错误）
  if (error && typeof error === 'object') {
    const err = error as any;

    // 处理 Taro 请求错误
    if (err.errMsg) {
      let errorType = ErrorType.NETWORK_ERROR;
      let message = err.errMsg;

      if (err.errMsg.includes('timeout')) {
        errorType = ErrorType.TIMEOUT;
        message = ERROR_MESSAGES[ErrorType.TIMEOUT];
      } else if (err.errMsg.includes('fail')) {
        errorType = ErrorType.NETWORK_ERROR;
        message = ERROR_MESSAGES[ErrorType.NETWORK_ERROR];
      }

      const appError = new AppError(errorType, message, {
        originalError: err,
        context,
      });

      console.error('[Taro Error]', {
        type: appError.type,
        message: appError.message,
        errMsg: err.errMsg,
        context,
      });

      return appError;
    }

    // 处理 API 错误响应
    if (err.error && err.error.message) {
      const appError = new AppError(ErrorType.API_ERROR, err.error.message, {
        code: err.error.code,
        originalError: err,
        context,
      });

      console.error('[API Error]', {
        type: appError.type,
        message: appError.message,
        code: err.error.code,
        context,
      });

      return appError;
    }

    // 处理包含 message 字段的对象
    if (err.message) {
      const appError = new AppError(ErrorType.UNKNOWN_ERROR, err.message, {
        originalError: err,
        context,
      });

      console.error('[Object Error]', {
        type: appError.type,
        message: appError.message,
        originalError: err,
        context,
      });

      return appError;
    }
  }

  // 字符串类型
  if (typeof error === 'string') {
    const appError = new AppError(ErrorType.UNKNOWN_ERROR, error, {context});

    console.error('[String Error]', {
      type: appError.type,
      message: appError.message,
      context,
    });

    return appError;
  }

  // 完全未知的错误
  const appError = new AppError(
    ErrorType.UNKNOWN_ERROR,
    ERROR_MESSAGES[ErrorType.UNKNOWN_ERROR],
    {
      originalError: error,
      context,
    },
  );

  console.error('[Unknown Error]', {
    type: appError.type,
    message: appError.message,
    originalError: error,
    context,
  });

  return appError;
}

/**
 * 显示错误提示
 *
 * 使用统一反馈工具显示用户友好的错误提示
 *
 * @param error 错误对象（可以是任何类型）
 * @param duration 提示持续时间（毫秒），默认 3000
 *
 * @example
 * ```typescript
 * try {
 *   await apiCall()
 * } catch (error) {
 *   showErrorToast(error)
 * }
 * ```
 *
 * **Validates: Requirements 7.4**
 */
export function showErrorToast(error: unknown, duration: number = 3000): void {
  const message = getErrorMessage(error);

  feedback.toast({
    title: message,
    icon: 'none',
    duration,
  });
}

/**
 * 显示错误模态框
 *
 * 使用统一反馈工具显示详细的错误信息
 *
 * @param error 错误对象
 * @param options 模态框选项
 *
 * @example
 * ```typescript
 * try {
 *   await apiCall()
 * } catch (error) {
 *   showErrorModal(error, {
 *     title: '操作失败',
 *     confirmText: '重试',
 *     onConfirm: () => retry()
 *   })
 * }
 * ```
 */
export function showErrorModal(
  error: unknown,
  options?: {
    title?: string;
    confirmText?: string;
    cancelText?: string;
    onConfirm?: () => void;
    onCancel?: () => void;
  },
): void {
  const message = getErrorMessage(error);

  feedback.modal({
    title: options?.title || '错误',
    content: message,
    confirmText: options?.confirmText || '确定',
    cancelText: options?.cancelText,
    showCancel: !!options?.cancelText,
    onConfirm: options?.onConfirm,
    onCancel: options?.onCancel,
  });
}

/**
 * 创建网络错误
 *
 * @param message 错误消息（可选）
 * @param details 错误详情（可选）
 * @returns AppError 实例
 *
 * @example
 * ```typescript
 * throw createNetworkError('无法连接到服务器')
 * ```
 */
export function createNetworkError(message?: string, details?: any): AppError {
  return new AppError(
    ErrorType.NETWORK_ERROR,
    message || ERROR_MESSAGES[ErrorType.NETWORK_ERROR],
    details,
  );
}

/**
 * 创建超时错误
 *
 * @param message 错误消息（可选）
 * @param details 错误详情（可选）
 * @returns AppError 实例
 *
 * @example
 * ```typescript
 * throw createTimeoutError()
 * ```
 */
export function createTimeoutError(message?: string, details?: any): AppError {
  return new AppError(
    ErrorType.TIMEOUT,
    message || ERROR_MESSAGES[ErrorType.TIMEOUT],
    details,
  );
}

/**
 * 创建 API 错误
 *
 * @param message 错误消息
 * @param details 错误详情（可选）
 * @returns AppError 实例
 *
 * @example
 * ```typescript
 * throw createApiError('服务器返回错误', { code: 'INVALID_INPUT' })
 * ```
 */
export function createApiError(message: string, details?: any): AppError {
  return new AppError(ErrorType.API_ERROR, message, details);
}

/**
 * 创建验证错误
 *
 * @param message 错误消息
 * @param details 错误详情（可选）
 * @returns AppError 实例
 *
 * @example
 * ```typescript
 * throw createValidationError('简历内容不能为空', { field: 'resume' })
 * ```
 */
export function createValidationError(
  message: string,
  details?: any,
): AppError {
  return new AppError(ErrorType.VALIDATION_ERROR, message, details);
}

/**
 * 创建业务错误
 *
 * @param message 错误消息
 * @param details 错误详情（可选）
 * @returns AppError 实例
 *
 * @example
 * ```typescript
 * throw createBusinessError('简历分析失败')
 * ```
 */
export function createBusinessError(message: string, details?: any): AppError {
  return new AppError(ErrorType.BUSINESS_ERROR, message, details);
}

/**
 * 判断是否是网络错误
 *
 * @param error 错误对象
 * @returns 是否是网络错误
 *
 * @example
 * ```typescript
 * if (isNetworkError(error)) {
 *   console.log('网络错误，请检查网络连接')
 * }
 * ```
 */
export function isNetworkError(error: unknown): boolean {
  if (error instanceof AppError) {
    return (
      error.type === ErrorType.NETWORK_ERROR || error.type === ErrorType.TIMEOUT
    );
  }
  return false;
}

/**
 * 判断是否是 API 错误
 *
 * @param error 错误对象
 * @returns 是否是 API 错误
 *
 * @example
 * ```typescript
 * if (isApiError(error)) {
 *   console.log('API 错误')
 * }
 * ```
 */
export function isApiError(error: unknown): boolean {
  if (error instanceof AppError) {
    return error.type === ErrorType.API_ERROR;
  }
  return false;
}

/**
 * 判断是否是验证错误
 *
 * @param error 错误对象
 * @returns 是否是验证错误
 *
 * @example
 * ```typescript
 * if (isValidationError(error)) {
 *   console.log('输入验证失败')
 * }
 * ```
 */
export function isValidationError(error: unknown): boolean {
  if (error instanceof AppError) {
    return error.type === ErrorType.VALIDATION_ERROR;
  }
  return false;
}
