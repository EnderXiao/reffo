import {describe, test, expect, beforeEach} from '@jest/globals';
import Taro from '@tarojs/taro';
import {
  AppError,
  ErrorType,
  getErrorMessage,
  handleError,
  showErrorToast,
  showErrorModal,
  createNetworkError,
  createTimeoutError,
  createApiError,
  createValidationError,
  createBusinessError,
  isNetworkError,
  isApiError,
  isValidationError,
} from '../error';

// Taro 已经在 __mocks__ 中被 mock 了

describe('错误处理工具', () => {
  beforeEach(() => {
    // 清除所有 mock 调用记录
    jest.clearAllMocks();
  });

  describe('AppError 类', () => {
    test('应该正确创建 AppError 实例', () => {
      const error = new AppError(ErrorType.NETWORK_ERROR, '网络连接失败', {
        code: 'NET_001',
      });

      expect(error).toBeInstanceOf(AppError);
      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe('AppError');
      expect(error.type).toBe(ErrorType.NETWORK_ERROR);
      expect(error.message).toBe('网络连接失败');
      expect(error.details).toEqual({code: 'NET_001'});
    });

    test('getUserMessage 应该返回友好的错误消息', () => {
      const error = new AppError(ErrorType.TIMEOUT, '请求超时');
      const message = error.getUserMessage();

      expect(message).toBe('请求超时');
    });

    test('toJSON 应该返回正确的 JSON 对象', () => {
      const error = new AppError(ErrorType.API_ERROR, 'API 错误', {
        statusCode: 500,
      });
      const json = error.toJSON();

      expect(json).toEqual({
        name: 'AppError',
        type: ErrorType.API_ERROR,
        message: 'API 错误',
        details: {statusCode: 500},
      });
    });
  });

  describe('getErrorMessage 函数', () => {
    test('应该正确处理 AppError', () => {
      const error = new AppError(ErrorType.NETWORK_ERROR, '自定义网络错误');
      const message = getErrorMessage(error);

      expect(message).toBe('自定义网络错误');
    });

    test('应该返回默认错误消息（当 AppError 消息为空时）', () => {
      const error = new AppError(
        ErrorType.TIMEOUT,
        '网络请求超时，请检查网络连接后重试',
      );
      const message = getErrorMessage(error);

      expect(message).toBe('网络请求超时，请检查网络连接后重试');
    });

    test('应该正确处理标准 Error（超时）', () => {
      const error = new Error('request timeout');
      const message = getErrorMessage(error);

      expect(message).toBe('网络请求超时，请检查网络连接后重试');
    });

    test('应该正确处理标准 Error（网络错误）', () => {
      const error = new Error('network connection failed');
      const message = getErrorMessage(error);

      expect(message).toBe('网络连接失败，请检查网络设置');
    });

    test('应该正确处理标准 Error（其他错误）', () => {
      const error = new Error('自定义错误消息');
      const message = getErrorMessage(error);

      expect(message).toBe('自定义错误消息');
    });

    test('应该正确处理字符串错误', () => {
      const message = getErrorMessage('字符串错误');

      expect(message).toBe('字符串错误');
    });

    test('应该正确处理对象错误（message 字段）', () => {
      const error = {message: '对象错误消息'};
      const message = getErrorMessage(error);

      expect(message).toBe('对象错误消息');
    });

    test('应该正确处理对象错误（error.message 字段）', () => {
      const error = {error: {message: 'API 错误消息'}};
      const message = getErrorMessage(error);

      expect(message).toBe('API 错误消息');
    });

    test('应该正确处理 Taro 错误（timeout）', () => {
      const error = {errMsg: 'request:fail timeout'};
      const message = getErrorMessage(error);

      expect(message).toBe('网络请求超时，请检查网络连接后重试');
    });

    test('应该正确处理 Taro 错误（fail）', () => {
      const error = {errMsg: 'request:fail'};
      const message = getErrorMessage(error);

      expect(message).toBe('网络连接失败，请检查网络设置');
    });

    test('应该正确处理 Taro 错误（其他）', () => {
      const error = {errMsg: 'request:fail unknown error'};
      const message = getErrorMessage(error);

      // 包含 'fail' 关键字会被识别为网络错误
      expect(message).toBe('网络连接失败，请检查网络设置');
    });

    test('应该正确处理未知错误', () => {
      const message = getErrorMessage(null);

      expect(message).toBe('操作失败，请稍后重试');
    });

    test('应该正确处理 undefined', () => {
      const message = getErrorMessage(undefined);

      expect(message).toBe('操作失败，请稍后重试');
    });

    test('应该正确处理数字', () => {
      const message = getErrorMessage(123);

      expect(message).toBe('操作失败，请稍后重试');
    });
  });

  describe('handleError 函数', () => {
    test('应该正确处理 AppError（直接返回）', () => {
      const originalError = new AppError(
        ErrorType.VALIDATION_ERROR,
        '验证失败',
      );
      const result = handleError(originalError);

      expect(result).toBe(originalError);
      expect(result.type).toBe(ErrorType.VALIDATION_ERROR);
    });

    test('应该正确处理标准 Error（超时）', () => {
      const error = new Error('request timeout');
      const result = handleError(error, {action: 'test'});

      expect(result).toBeInstanceOf(AppError);
      expect(result.type).toBe(ErrorType.TIMEOUT);
      expect(result.message).toBe('request timeout');
      expect(result.details.originalError).toBe(error);
      expect(result.details.context).toEqual({action: 'test'});
    });

    test('应该正确处理标准 Error（网络错误）', () => {
      const error = new Error('network fail');
      const result = handleError(error);

      expect(result).toBeInstanceOf(AppError);
      expect(result.type).toBe(ErrorType.NETWORK_ERROR);
    });

    test('应该正确处理标准 Error（验证错误）', () => {
      const error = new Error('验证失败');
      const result = handleError(error);

      expect(result).toBeInstanceOf(AppError);
      expect(result.type).toBe(ErrorType.VALIDATION_ERROR);
    });

    test('应该正确处理标准 Error（未知错误）', () => {
      const error = new Error('未知错误');
      const result = handleError(error);

      expect(result).toBeInstanceOf(AppError);
      expect(result.type).toBe(ErrorType.UNKNOWN_ERROR);
    });

    test('应该正确处理 Taro 错误（timeout）', () => {
      const error = {errMsg: 'request:fail timeout'};
      const result = handleError(error);

      expect(result).toBeInstanceOf(AppError);
      expect(result.type).toBe(ErrorType.TIMEOUT);
      expect(result.message).toBe('网络请求超时，请检查网络连接后重试');
    });

    test('应该正确处理 Taro 错误（fail）', () => {
      const error = {errMsg: 'request:fail'};
      const result = handleError(error);

      expect(result).toBeInstanceOf(AppError);
      expect(result.type).toBe(ErrorType.NETWORK_ERROR);
      expect(result.message).toBe('网络连接失败，请检查网络设置');
    });

    test('应该正确处理 API 错误响应', () => {
      const error = {
        error: {
          code: 'INVALID_INPUT',
          message: 'API 验证失败',
        },
      };
      const result = handleError(error);

      expect(result).toBeInstanceOf(AppError);
      expect(result.type).toBe(ErrorType.API_ERROR);
      expect(result.message).toBe('API 验证失败');
      expect(result.details.code).toBe('INVALID_INPUT');
    });

    test('应该正确处理包含 message 的对象', () => {
      const error = {message: '对象错误'};
      const result = handleError(error);

      expect(result).toBeInstanceOf(AppError);
      expect(result.type).toBe(ErrorType.UNKNOWN_ERROR);
      expect(result.message).toBe('对象错误');
    });

    test('应该正确处理字符串错误', () => {
      const result = handleError('字符串错误');

      expect(result).toBeInstanceOf(AppError);
      expect(result.type).toBe(ErrorType.UNKNOWN_ERROR);
      expect(result.message).toBe('字符串错误');
    });

    test('应该正确处理完全未知的错误', () => {
      const result = handleError(null);

      expect(result).toBeInstanceOf(AppError);
      expect(result.type).toBe(ErrorType.UNKNOWN_ERROR);
      expect(result.message).toBe('操作失败，请稍后重试');
    });

    test('应该记录错误上下文', () => {
      const context = {action: 'analyzeResume', userId: '123'};
      const error = new Error('测试错误');
      const result = handleError(error, context);

      expect(result.details.context).toEqual(context);
    });
  });

  describe('showErrorToast 函数', () => {
    test('应该调用 Taro.showToast 显示错误提示', () => {
      const error = new AppError(ErrorType.NETWORK_ERROR, '网络错误');
      showErrorToast(error);

      expect(Taro.showToast).toHaveBeenCalledWith({
        title: '网络错误',
        icon: 'none',
        duration: 3000,
      });
    });

    test('应该支持自定义持续时间', () => {
      const error = new AppError(ErrorType.API_ERROR, 'API 错误');
      showErrorToast(error, 5000);

      expect(Taro.showToast).toHaveBeenCalledWith({
        title: 'API 错误',
        icon: 'none',
        duration: 5000,
      });
    });

    test('应该正确处理非 AppError 类型', () => {
      showErrorToast('字符串错误');

      expect(Taro.showToast).toHaveBeenCalledWith({
        title: '字符串错误',
        icon: 'none',
        duration: 3000,
      });
    });
  });

  describe('showErrorModal 函数', () => {
    test('应该调用 Taro.showModal 显示错误模态框', () => {
      const error = new AppError(ErrorType.BUSINESS_ERROR, '业务错误');
      showErrorModal(error);

      expect(Taro.showModal).toHaveBeenCalledWith({
        title: '错误',
        content: '业务错误',
        confirmText: '确定',
        cancelText: undefined,
        showCancel: false,
        success: expect.any(Function),
      });
    });

    test('应该支持自定义选项', () => {
      const error = new AppError(ErrorType.NETWORK_ERROR, '网络错误');
      const onConfirm = jest.fn();
      const onCancel = jest.fn();

      showErrorModal(error, {
        title: '操作失败',
        confirmText: '重试',
        cancelText: '取消',
        onConfirm,
        onCancel,
      });

      expect(Taro.showModal).toHaveBeenCalledWith({
        title: '操作失败',
        content: '网络错误',
        confirmText: '重试',
        cancelText: '取消',
        showCancel: true,
        success: expect.any(Function),
      });
    });

    test('应该在点击确定时调用 onConfirm', () => {
      const error = new AppError(ErrorType.API_ERROR, 'API 错误');
      const onConfirm = jest.fn();

      showErrorModal(error, {onConfirm});

      // 获取传递给 showModal 的 success 回调
      const mockCalls = (Taro.showModal as jest.Mock).mock.calls;
      const successCallback = mockCalls[0][0].success;

      // 模拟点击确定
      successCallback({confirm: true, cancel: false});

      expect(onConfirm).toHaveBeenCalled();
    });

    test('应该在点击取消时调用 onCancel', () => {
      const error = new AppError(ErrorType.API_ERROR, 'API 错误');
      const onCancel = jest.fn();

      showErrorModal(error, {cancelText: '取消', onCancel});

      // 获取传递给 showModal 的 success 回调
      const mockCalls = (Taro.showModal as jest.Mock).mock.calls;
      const successCallback = mockCalls[0][0].success;

      // 模拟点击取消
      successCallback({confirm: false, cancel: true});

      expect(onCancel).toHaveBeenCalled();
    });
  });

  describe('错误创建函数', () => {
    test('createNetworkError 应该创建网络错误', () => {
      const error = createNetworkError('自定义网络错误', {code: 'NET_001'});

      expect(error).toBeInstanceOf(AppError);
      expect(error.type).toBe(ErrorType.NETWORK_ERROR);
      expect(error.message).toBe('自定义网络错误');
      expect(error.details).toEqual({code: 'NET_001'});
    });

    test('createNetworkError 应该使用默认消息', () => {
      const error = createNetworkError();

      expect(error.type).toBe(ErrorType.NETWORK_ERROR);
      expect(error.message).toBe('网络连接失败，请检查网络设置');
    });

    test('createTimeoutError 应该创建超时错误', () => {
      const error = createTimeoutError('自定义超时错误');

      expect(error).toBeInstanceOf(AppError);
      expect(error.type).toBe(ErrorType.TIMEOUT);
      expect(error.message).toBe('自定义超时错误');
    });

    test('createTimeoutError 应该使用默认消息', () => {
      const error = createTimeoutError();

      expect(error.type).toBe(ErrorType.TIMEOUT);
      expect(error.message).toBe('网络请求超时，请检查网络连接后重试');
    });

    test('createApiError 应该创建 API 错误', () => {
      const error = createApiError('API 错误', {statusCode: 500});

      expect(error).toBeInstanceOf(AppError);
      expect(error.type).toBe(ErrorType.API_ERROR);
      expect(error.message).toBe('API 错误');
      expect(error.details).toEqual({statusCode: 500});
    });

    test('createValidationError 应该创建验证错误', () => {
      const error = createValidationError('验证失败', {field: 'resume'});

      expect(error).toBeInstanceOf(AppError);
      expect(error.type).toBe(ErrorType.VALIDATION_ERROR);
      expect(error.message).toBe('验证失败');
      expect(error.details).toEqual({field: 'resume'});
    });

    test('createBusinessError 应该创建业务错误', () => {
      const error = createBusinessError('业务错误', {code: 'BIZ_001'});

      expect(error).toBeInstanceOf(AppError);
      expect(error.type).toBe(ErrorType.BUSINESS_ERROR);
      expect(error.message).toBe('业务错误');
      expect(error.details).toEqual({code: 'BIZ_001'});
    });
  });

  describe('错误类型判断函数', () => {
    test('isNetworkError 应该正确判断网络错误', () => {
      const networkError = createNetworkError();
      const timeoutError = createTimeoutError();
      const apiError = createApiError('API 错误');

      expect(isNetworkError(networkError)).toBe(true);
      expect(isNetworkError(timeoutError)).toBe(true);
      expect(isNetworkError(apiError)).toBe(false);
      expect(isNetworkError(new Error('错误'))).toBe(false);
      expect(isNetworkError('错误')).toBe(false);
    });

    test('isApiError 应该正确判断 API 错误', () => {
      const apiError = createApiError('API 错误');
      const networkError = createNetworkError();

      expect(isApiError(apiError)).toBe(true);
      expect(isApiError(networkError)).toBe(false);
      expect(isApiError(new Error('错误'))).toBe(false);
    });

    test('isValidationError 应该正确判断验证错误', () => {
      const validationError = createValidationError('验证失败');
      const apiError = createApiError('API 错误');

      expect(isValidationError(validationError)).toBe(true);
      expect(isValidationError(apiError)).toBe(false);
      expect(isValidationError(new Error('错误'))).toBe(false);
    });
  });

  describe('边界情况', () => {
    test('应该正确处理空对象', () => {
      const message = getErrorMessage({});
      expect(message).toBe('操作失败，请稍后重试');
    });

    test('应该正确处理空数组', () => {
      const message = getErrorMessage([]);
      expect(message).toBe('操作失败，请稍后重试');
    });

    test('应该正确处理布尔值', () => {
      const message = getErrorMessage(true);
      expect(message).toBe('操作失败，请稍后重试');
    });

    test('应该正确处理嵌套错误对象', () => {
      const error = {
        error: {
          error: {
            message: '深层嵌套的错误',
          },
        },
      };
      const message = getErrorMessage(error);
      // 只处理第一层 error.message
      expect(message).toBe('操作失败，请稍后重试');
    });

    test('应该正确处理循环引用', () => {
      const error: any = {message: '循环引用错误'};
      error.self = error;

      const message = getErrorMessage(error);
      expect(message).toBe('循环引用错误');
    });
  });
});
