import Taro from '@tarojs/taro'

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
  data?: unknown;
  /** 请求头 */
  header?: Record<string, string>;
  /** 超时时间（毫秒），默认 30000 */
  timeout?: number;
  /** 数据类型，默认 json */
  dataType?: 'json' | 'text' | 'html';
  /** 响应类型，默认 text */
  responseType?: 'text' | 'arraybuffer';
  /** 可选取消信号 */
  signal?: AbortSignal;
}

/**
 * 响应数据接口
 *
 * 定义网络请求的响应结构
 */
export interface Response<T = unknown> {
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
    public response?: unknown,
  ) {
    super(message);
    this.name = 'RequestError';
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
  request<T = unknown>(config: RequestConfig): Promise<Response<T>>;
  /** 设置底层默认超时时间 */
  setDefaultTimeout(timeout: number): void;
}

function normalizeRequestError(error: unknown): RequestError {
  if (error instanceof RequestError) return error

  if (error && typeof error === 'object') {
    const err = error as {errMsg?: unknown; message?: unknown}
    const errMsg = typeof err.errMsg === 'string' ? err.errMsg : ''
    if (errMsg.includes('abort') || errMsg.includes('cancel')) {
      return new RequestError('请求已取消', 'CANCELLED')
    }
    if (errMsg.includes('timeout')) {
      return new RequestError('请求超时，请检查网络连接', 'TIMEOUT')
    }
    if (errMsg.includes('fail')) {
      return new RequestError('网络请求失败，请检查网络连接', 'NETWORK_ERROR')
    }
    return new RequestError(
      errMsg || (typeof err.message === 'string' ? err.message : '未知错误'),
      errMsg ? 'REQUEST_ERROR' : 'UNKNOWN_ERROR',
    )
  }

  return new RequestError('未知错误', 'UNKNOWN_ERROR')
}

async function resolveRequestTask<T extends PromiseLike<unknown> & {abort?: () => void}>(
  task: T,
  signal?: AbortSignal,
): Promise<Awaited<T>> {
  if (!signal) return task as unknown as Promise<Awaited<T>>
  if (signal.aborted) {
    task.abort?.()
    throw new RequestError('请求已取消', 'CANCELLED')
  }

  return new Promise<Awaited<T>>((resolve, reject) => {
    const onAbort = () => {
      task.abort?.()
      reject(new RequestError('请求已取消', 'CANCELLED'))
    }
    signal.addEventListener('abort', onAbort, {once: true})
    Promise.resolve(task).then(
      value => {
        signal.removeEventListener('abort', onAbort)
        resolve(value as Awaited<T>)
      },
      error => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
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
 * - 支持请求取消和超时控制
 * - 超时控制
 * - 类型安全
 *
 * @example
 * ```typescript
 * const request = new TaroRequestAdapter()
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
  /** 默认超时时间（毫秒） */
  private defaultTimeout = 30000;

  /**
   * 发起网络请求
   *
   * 使用 Taro.request 发起网络请求，统一错误和取消语义
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
  async request<T = unknown>(config: RequestConfig): Promise<Response<T>> {
    try {
      // 设置默认值
      const requestConfig = {
        url: config.url,
        method: config.method || 'GET',
        data: config.data,
        header: {
          'Content-Type': 'application/json',
          ...config.header,
        },
        timeout: config.timeout || this.defaultTimeout,
        dataType: config.dataType || 'json',
        responseType: config.responseType || 'text',
      };

      // 发起请求
      const requestTask = Taro.request(
        requestConfig as Parameters<typeof Taro.request>[0],
      ) as PromiseLike<{
        data: unknown;
        statusCode: number;
        header?: Record<string, string>;
      }> & {abort?: () => void};
      const taroResponse = await resolveRequestTask(requestTask, config.signal);

      // 构建响应对象
      const response: Response<T> = {
        data: taroResponse.data as T,
        statusCode: taroResponse.statusCode,
        header: taroResponse.header || {},
        success:
          taroResponse.statusCode >= 200 && taroResponse.statusCode < 300,
      };

      // 检查 HTTP 状态码
      if (!response.success) {
        throw new RequestError(
          `HTTP 错误: ${response.statusCode}`,
          'HTTP_ERROR',
          response.statusCode,
          response.data,
        );
      }

      return response;
    } catch (error) {
      throw normalizeRequestError(error)
    }
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
  async get<T = unknown>(
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
  async post<T = unknown>(
    url: string,
    data?: unknown,
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
  async put<T = unknown>(
    url: string,
    data?: unknown,
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
  async delete<T = unknown>(
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
