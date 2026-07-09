import Taro from '@tarojs/taro';

/**
 * HTTP 请求方法
 */
export type RequestMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

/**
 * 请求配置接口
 *
 * 定义网络请求的配置选项
 */
export interface RequestConfig {
  /** 请求 URL */
  url: string;
  /** 请求方法，默认 GET */
  method?: RequestMethod;
  /** 请求数据 */
  data?: any;
  /** 请求头 */
  header?: Record<string, string>;
  /** 超时时间（毫秒），默认 30000 */
  timeout?: number;
  /** 数据类型，默认 json */
  dataType?: 'json' | 'text' | 'html';
  /** 响应类型，默认 text */
  responseType?: 'text' | 'arraybuffer';
}

/**
 * 响应数据接口
 *
 * 定义网络请求的响应结构
 */
export interface Response<T = any> {
  /** 响应数据 */
  data: T;
  /** HTTP 状态码 */
  statusCode: number;
  /** 响应头 */
  header: Record<string, string>;
  /** 是否成功（状态码 2xx） */
  success: boolean;
}

/**
 * 请求拦截器函数类型
 *
 * 在请求发送前调用，可以修改请求配置
 */
export type RequestInterceptor = (
  config: RequestConfig,
) => RequestConfig | Promise<RequestConfig>;

/**
 * 响应拦截器函数类型
 *
 * 在响应返回后调用，可以处理响应数据
 */
export type ResponseInterceptor = <T>(
  response: Response<T>,
) => Response<T> | Promise<Response<T>>;

/**
 * 错误拦截器函数类型
 *
 * 在请求或响应出错时调用
 */
export type ErrorInterceptor = (error: RequestError) => void | Promise<void>;

/**
 * 请求错误类
 *
 * 封装网络请求错误信息
 */
export class RequestError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode?: number,
    public response?: any,
  ) {
    super(message);
    this.name = 'RequestError';
  }
}

function getApiErrorPayload(data: unknown) {
  if (!data || typeof data !== 'object' || !('success' in data)) {
    return null
  }

  const payload = data as { success?: unknown; error?: { code?: unknown; message?: unknown; details?: unknown } }
  if (payload.success !== false || !payload.error) {
    return null
  }

  return {
    code: typeof payload.error.code === 'string' ? payload.error.code : 'API_ERROR',
    message: typeof payload.error.message === 'string' ? payload.error.message : '请求失败',
    details: payload.error.details,
  }
}

/**
 * 平台兼容的网络请求接口
 *
 * 提供统一的网络请求 API，屏蔽不同平台的差异
 *
 * **Validates: Requirements 3.4**
 */
export interface RequestAdapter {
  /**
   * 发起网络请求
   *
   * @param config 请求配置
   * @returns Promise<Response<T>> 响应数据
   * @throws {RequestError} 当请求失败时抛出错误
   */
  request<T = any>(config: RequestConfig): Promise<Response<T>>;

  /**
   * 添加请求拦截器
   *
   * @param interceptor 拦截器函数
   */
  addRequestInterceptor(interceptor: RequestInterceptor): void;

  /**
   * 添加响应拦截器
   *
   * @param interceptor 拦截器函数
   */
  addResponseInterceptor(interceptor: ResponseInterceptor): void;

  /**
   * 添加错误拦截器
   *
   * @param interceptor 拦截器函数
   */
  addErrorInterceptor(interceptor: ErrorInterceptor): void;
}

/**
 * 基于 Taro API 的网络请求适配器实现
 *
 * 使用 Taro.request API 实现跨平台网络请求
 *
 * **特性：**
 * - 自动处理不同平台的请求 API 差异
 * - 统一的 Promise 接口
 * - 完善的错误处理
 * - 支持请求/响应拦截器
 * - 超时控制
 * - 类型安全
 *
 * @example
 * ```typescript
 * const request = new TaroRequestAdapter()
 *
 * // 添加请求拦截器（添加 token）
 * request.addRequestInterceptor((config) => {
 *   config.header = {
 *     ...config.header,
 *     'Authorization': `Bearer ${token}`
 *   }
 *   return config
 * })
 *
 * // 发起 GET 请求
 * const response = await request.request({
 *   url: 'https://api.example.com/data',
 *   method: 'GET'
 * })
 *
 * // 发起 POST 请求
 * const response = await request.request({
 *   url: 'https://api.example.com/data',
 *   method: 'POST',
 *   data: { name: '张三' }
 * })
 * ```
 *
 * **Validates: Requirements 3.4**
 */
export class TaroRequestAdapter implements RequestAdapter {
  /** 请求拦截器列表 */
  private requestInterceptors: RequestInterceptor[] = [];

  /** 响应拦截器列表 */
  private responseInterceptors: ResponseInterceptor[] = [];

  /** 错误拦截器列表 */
  private errorInterceptors: ErrorInterceptor[] = [];

  /** 默认超时时间（毫秒） */
  private defaultTimeout = 30000;

  /**
   * 发起网络请求
   *
   * 使用 Taro.request 发起网络请求，支持拦截器和错误处理
   *
   * @param config 请求配置
   * @returns Promise<Response<T>> 响应数据
   * @throws {RequestError} 当请求失败时抛出错误
   *
   * @example
   * ```typescript
   * try {
   *   const response = await request.request({
   *     url: 'https://api.example.com/data',
   *     method: 'POST',
   *     data: { key: 'value' },
   *     timeout: 10000
   *   })
   *   console.log('响应数据:', response.data)
   * } catch (error) {
   *   if (error instanceof RequestError) {
   *     console.error('请求失败:', error.message)
   *   }
   * }
   * ```
   */
  async request<T = any>(config: RequestConfig): Promise<Response<T>> {
    try {
      // 应用请求拦截器
      let finalConfig = config;
      for (const interceptor of this.requestInterceptors) {
        finalConfig = await interceptor(finalConfig);
      }

      // 设置默认值
      const requestConfig = {
        url: finalConfig.url,
        method: (finalConfig.method || 'GET') as any,
        data: finalConfig.data,
        header: {
          'Content-Type': 'application/json',
          ...finalConfig.header,
        },
        timeout: finalConfig.timeout || this.defaultTimeout,
        dataType: finalConfig.dataType || 'json',
        responseType: finalConfig.responseType || 'text',
      };

      // 记录请求日志
      console.log('[Request]', {
        method: requestConfig.method,
        url: requestConfig.url,
        data: requestConfig.data,
      });

      // 发起请求
      const taroResponse = await Taro.request(requestConfig);

      // 构建响应对象
      const response: Response<T> = {
        data: taroResponse.data as T,
        statusCode: taroResponse.statusCode,
        header: taroResponse.header as Record<string, string>,
        success:
          taroResponse.statusCode >= 200 && taroResponse.statusCode < 300,
      };

      // 记录响应日志
      console.log('[Response]', {
        method: requestConfig.method,
        url: requestConfig.url,
        statusCode: response.statusCode,
        success: response.success,
      });

      // 检查 HTTP 状态码
      if (!response.success) {
        const apiError = getApiErrorPayload(response.data)
        throw new RequestError(
          apiError?.message || `HTTP 错误: ${response.statusCode}`,
          apiError?.code || 'HTTP_ERROR',
          response.statusCode,
          apiError?.details ?? response.data,
        );
      }

      // 应用响应拦截器
      let finalResponse = response;
      for (const interceptor of this.responseInterceptors) {
        finalResponse = await interceptor(finalResponse);
      }

      return finalResponse;
    } catch (error) {
      // 构建错误对象
      let requestError: RequestError;

      if (error instanceof RequestError) {
        requestError = error;
      } else if (error && typeof error === 'object') {
        const err = error as any;

        // 处理 Taro 请求错误
        if (err.errMsg) {
          if (err.errMsg.includes('timeout')) {
            requestError = new RequestError(
              '请求超时，请检查网络连接',
              'TIMEOUT',
            );
          } else if (err.errMsg.includes('fail')) {
            requestError = new RequestError(
              '网络请求失败，请检查网络连接',
              'NETWORK_ERROR',
            );
          } else {
            requestError = new RequestError(
              err.errMsg || '请求失败',
              'REQUEST_ERROR',
            );
          }
        } else {
          requestError = new RequestError(
            err.message || '未知错误',
            'UNKNOWN_ERROR',
          );
        }
      } else {
        requestError = new RequestError('未知错误', 'UNKNOWN_ERROR');
      }

      // 记录错误日志
      console.error('[Request Error]', {
        method: config.method,
        url: config.url,
        code: requestError.code,
        message: requestError.message,
      });

      // 应用错误拦截器
      for (const interceptor of this.errorInterceptors) {
        await interceptor(requestError);
      }

      throw requestError;
    }
  }

  /**
   * 添加请求拦截器
   *
   * 在请求发送前调用，可以修改请求配置（如添加 token）
   *
   * @param interceptor 拦截器函数
   *
   * @example
   * ```typescript
   * request.addRequestInterceptor((config) => {
   *   // 添加认证 token
   *   config.header = {
   *     ...config.header,
   *     'Authorization': `Bearer ${getToken()}`
   *   }
   *   return config
   * })
   * ```
   */
  addRequestInterceptor(interceptor: RequestInterceptor): void {
    this.requestInterceptors.push(interceptor);
  }

  /**
   * 添加响应拦截器
   *
   * 在响应返回后调用，可以处理响应数据
   *
   * @param interceptor 拦截器函数
   *
   * @example
   * ```typescript
   * request.addResponseInterceptor((response) => {
   *   // 统一处理业务错误
   *   if (response.data.code !== 0) {
   *     throw new Error(response.data.message)
   *   }
   *   return response
   * })
   * ```
   */
  addResponseInterceptor(interceptor: ResponseInterceptor): void {
    this.responseInterceptors.push(interceptor);
  }

  /**
   * 添加错误拦截器
   *
   * 在请求或响应出错时调用，可以统一处理错误（如显示提示）
   *
   * @param interceptor 拦截器函数
   *
   * @example
   * ```typescript
   * request.addErrorInterceptor((error) => {
   *   // 显示错误提示
   *   Taro.showToast({
   *     title: error.message,
   *     icon: 'none'
   *   })
   * })
   * ```
   */
  addErrorInterceptor(interceptor: ErrorInterceptor): void {
    this.errorInterceptors.push(interceptor);
  }

  /**
   * 设置默认超时时间
   *
   * @param timeout 超时时间（毫秒）
   *
   * @example
   * ```typescript
   * request.setDefaultTimeout(60000) // 设置为 60 秒
   * ```
   */
  setDefaultTimeout(timeout: number): void {
    this.defaultTimeout = timeout;
  }

  /**
   * GET 请求快捷方法
   *
   * @param url 请求 URL
   * @param config 额外配置
   * @returns Promise<Response<T>> 响应数据
   *
   * @example
   * ```typescript
   * const response = await request.get('/api/users')
   * ```
   */
  async get<T = any>(
    url: string,
    config?: Omit<RequestConfig, 'url' | 'method'>,
  ): Promise<Response<T>> {
    return this.request<T>({
      ...config,
      url,
      method: 'GET',
    });
  }

  /**
   * POST 请求快捷方法
   *
   * @param url 请求 URL
   * @param data 请求数据
   * @param config 额外配置
   * @returns Promise<Response<T>> 响应数据
   *
   * @example
   * ```typescript
   * const response = await request.post('/api/users', { name: '张三' })
   * ```
   */
  async post<T = any>(
    url: string,
    data?: any,
    config?: Omit<RequestConfig, 'url' | 'method' | 'data'>,
  ): Promise<Response<T>> {
    return this.request<T>({
      ...config,
      url,
      method: 'POST',
      data,
    });
  }

  /**
   * PUT 请求快捷方法
   *
   * @param url 请求 URL
   * @param data 请求数据
   * @param config 额外配置
   * @returns Promise<Response<T>> 响应数据
   *
   * @example
   * ```typescript
   * const response = await request.put('/api/users/1', { name: '李四' })
   * ```
   */
  async put<T = any>(
    url: string,
    data?: any,
    config?: Omit<RequestConfig, 'url' | 'method' | 'data'>,
  ): Promise<Response<T>> {
    return this.request<T>({
      ...config,
      url,
      method: 'PUT',
      data,
    });
  }

  /**
   * DELETE 请求快捷方法
   *
   * @param url 请求 URL
   * @param config 额外配置
   * @returns Promise<Response<T>> 响应数据
   *
   * @example
   * ```typescript
   * const response = await request.delete('/api/users/1')
   * ```
   */
  async delete<T = any>(
    url: string,
    config?: Omit<RequestConfig, 'url' | 'method'>,
  ): Promise<Response<T>> {
    return this.request<T>({
      ...config,
      url,
      method: 'DELETE',
    });
  }
}

/**
 * 默认请求适配器实例
 *
 * 提供一个全局单例，方便在应用中直接使用
 *
 * @example
 * ```typescript
 * import { request } from '@/utils/request'
 *
 * // 直接使用
 * const response = await request.get('/api/data')
 * ```
 */
export const request: RequestAdapter = new TaroRequestAdapter();
