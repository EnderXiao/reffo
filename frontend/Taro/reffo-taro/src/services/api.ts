import {TaroRequestAdapter, RequestError} from '@/utils/request';
import type {RequestConfig, Response} from '@/utils/request';
import {retry, type RetryOptions} from '@/utils/retry';

/**
 * API 响应格式
 *
 * 后端统一的响应格式
 */
export interface ApiResponse<T> {
  /** 是否成功 */
  success: boolean;
  /** 响应数据 */
  data?: T;
  /** 错误信息 */
  error?: {
    code: string;
    message: string;
    details?: any;
  };
  /** 可选的消息 */
  message?: string;
}

/**
 * API 配置接口
 */
export interface ApiConfig {
  /** API 基础 URL */
  baseURL: string;
  /** 请求超时时间（毫秒） */
  timeout?: number;
  /** 是否启用日志 */
  enableLog?: boolean;
  /** 重试配置 */
  retry?: RetryOptions | false;
}

/**
 * API 客户端基类
 *
 * 提供统一的 API 调用接口，封装请求/响应处理逻辑
 *
 * **特性：**
 * - 统一的 baseURL 配置
 * - 自动添加通用请求头
 * - 统一的响应格式处理
 * - 统一的错误处理
 * - 请求/响应日志记录
 * - 支持认证 token
 *
 * **Validates: Requirements 7.1**
 *
 * @example
 * ```typescript
 * // 创建 API 客户端实例
 * const apiClient = new ApiClient({
 *   baseURL: 'http://localhost:3000/api/v1',
 *   timeout: 30000
 * })
 *
 * // 发起 GET 请求
 * const data = await apiClient.get('/mvp/health')
 *
 * // 发起 POST 请求
 * const result = await apiClient.post('/mvp/analyze', {
 *   resume_markdown: '# 张三\n...'
 * })
 * ```
 */
export class ApiClient {
  /** 请求适配器 */
  private request: TaroRequestAdapter;

  /** API 基础 URL */
  private baseURL: string;

  /** 请求超时时间 */
  private timeout: number;

  /** 是否启用日志 */
  private enableLog: boolean;

  /** 重试配置 */
  private retryConfig: RetryOptions | false;

  /** 认证 token */
  private authToken: string | null = null;

  /**
   * 创建 API 客户端实例
   *
   * @param config API 配置
   */
  constructor(config: ApiConfig) {
    this.baseURL = config.baseURL;
    this.timeout = config.timeout || 30000;
    this.enableLog = config.enableLog !== false;

    // 配置重试机制
    // 默认启用重试，使用标准配置
    if (config.retry === false) {
      this.retryConfig = false;
    } else {
      this.retryConfig = {
        maxRetries: 3,
        delay: 1000,
        backoff: 'exponential',
        ...config.retry,
      };
    }

    // 创建请求适配器
    this.request = new TaroRequestAdapter();
    this.request.setDefaultTimeout(this.timeout);

    // 配置拦截器
    this.setupInterceptors();
  }

  /**
   * 配置请求/响应拦截器
   *
   * **实现要点：**
   * 1. 请求拦截器：添加 baseURL、通用请求头、认证 token
   * 2. 响应拦截器：统一处理响应格式、业务错误
   * 3. 错误拦截器：记录错误日志
   */
  private setupInterceptors(): void {
    // 请求拦截器
    this.request.addRequestInterceptor(config => {
      // 添加 baseURL
      if (!config.url.startsWith('http')) {
        config.url = `${this.baseURL}${config.url}`;
      }

      // 添加通用请求头
      config.header = {
        'Content-Type': 'application/json',
        ...config.header,
      };

      // 添加认证 token
      if (this.authToken) {
        config.header['Authorization'] = `Bearer ${this.authToken}`;
      }

      // 记录请求日志
      if (this.enableLog) {
        console.log('[API Request]', {
          method: config.method,
          url: config.url,
          data: config.data,
          timestamp: new Date().toISOString(),
        });
      }

      return config;
    });

    // 响应拦截器
    this.request.addResponseInterceptor(response => {
      // 记录响应日志
      if (this.enableLog) {
        console.log('[API Response]', {
          url: response.header['url'] || 'unknown',
          statusCode: response.statusCode,
          success: response.success,
          timestamp: new Date().toISOString(),
        });
      }

      // 检查业务错误
      const apiResponse = response.data as ApiResponse<any>;
      if (apiResponse && apiResponse.success === false) {
        throw new RequestError(
          apiResponse.error?.message || '请求失败',
          apiResponse.error?.code || 'API_ERROR',
          response.statusCode,
          apiResponse.error?.details,
        );
      }

      return response;
    });

    // 错误拦截器
    this.request.addErrorInterceptor(error => {
      // 记录错误日志
      if (this.enableLog) {
        console.error('[API Error]', {
          code: error.code,
          message: error.message,
          statusCode: error.statusCode,
          timestamp: new Date().toISOString(),
        });
      }
    });
  }

  /**
   * 设置认证 token
   *
   * @param token 认证 token
   *
   * @example
   * ```typescript
   * apiClient.setAuthToken('your-token-here')
   * ```
   */
  setAuthToken(token: string | null): void {
    this.authToken = token;
  }

  /**
   * 获取认证 token
   *
   * @returns 当前的认证 token
   */
  getAuthToken(): string | null {
    return this.authToken;
  }

  /**
   * 执行带重试的请求
   *
   * 如果启用了重试配置，自动对请求进行重试
   *
   * @param requestFn 请求函数
   * @returns Promise<T> 请求结果
   */
  private async executeWithRetry<T>(requestFn: () => Promise<T>): Promise<T> {
    // 如果禁用重试，直接执行
    if (this.retryConfig === false) {
      return requestFn();
    }

    // 使用重试机制执行
    return retry(requestFn, this.retryConfig);
  }

  /**
   * 发起 GET 请求
   *
   * @param url 请求路径（相对于 baseURL）
   * @param config 额外配置
   * @returns Promise<T> 响应数据
   * @throws {RequestError} 当请求失败时抛出错误
   *
   * @example
   * ```typescript
   * const data = await apiClient.get('/mvp/health')
   * ```
   */
  async get<T = any>(
    url: string,
    config?: Omit<RequestConfig, 'url' | 'method'>,
  ): Promise<T> {
    return this.executeWithRetry(async () => {
      const response = await this.request.get<ApiResponse<T>>(url, config);
      return response.data.data as T;
    });
  }

  /**
   * 发起 POST 请求
   *
   * @param url 请求路径（相对于 baseURL）
   * @param data 请求数据
   * @param config 额外配置
   * @returns Promise<T> 响应数据
   * @throws {RequestError} 当请求失败时抛出错误
   *
   * @example
   * ```typescript
   * const result = await apiClient.post('/mvp/analyze', {
   *   resume_markdown: '# 张三\n...'
   * })
   * ```
   */
  async post<T = any>(
    url: string,
    data?: any,
    config?: Omit<RequestConfig, 'url' | 'method' | 'data'>,
  ): Promise<T> {
    return this.executeWithRetry(async () => {
      const response = await this.request.post<ApiResponse<T>>(
        url,
        data,
        config,
      );
      return response.data.data as T;
    });
  }

  /**
   * 发起 PUT 请求
   *
   * @param url 请求路径（相对于 baseURL）
   * @param data 请求数据
   * @param config 额外配置
   * @returns Promise<T> 响应数据
   * @throws {RequestError} 当请求失败时抛出错误
   *
   * @example
   * ```typescript
   * const result = await apiClient.put('/users/1', {
   *   name: '李四'
   * })
   * ```
   */
  async put<T = any>(
    url: string,
    data?: any,
    config?: Omit<RequestConfig, 'url' | 'method' | 'data'>,
  ): Promise<T> {
    return this.executeWithRetry(async () => {
      const response = await this.request.put<ApiResponse<T>>(
        url,
        data,
        config,
      );
      return response.data.data as T;
    });
  }

  /**
   * 发起 DELETE 请求
   *
   * @param url 请求路径（相对于 baseURL）
   * @param config 额外配置
   * @returns Promise<T> 响应数据
   * @throws {RequestError} 当请求失败时抛出错误
   *
   * @example
   * ```typescript
   * await apiClient.delete('/users/1')
   * ```
   */
  async delete<T = any>(
    url: string,
    config?: Omit<RequestConfig, 'url' | 'method'>,
  ): Promise<T> {
    return this.executeWithRetry(async () => {
      const response = await this.request.delete<ApiResponse<T>>(url, config);
      return response.data.data as T;
    });
  }

  /**
   * 发起原始请求（不处理响应格式）
   *
   * 用于特殊场景，直接返回原始响应
   *
   * @param config 请求配置
   * @returns Promise<Response<T>> 原始响应
   *
   * @example
   * ```typescript
   * const response = await apiClient.request({
   *   url: '/custom-endpoint',
   *   method: 'POST',
   *   data: { key: 'value' }
   * })
   * ```
   */
  async request<T = any>(config: RequestConfig): Promise<Response<T>> {
    return this.request.request<T>(config);
  }
}

/**
 * 获取 API 基础 URL
 *
 * 根据环境变量或默认配置返回 API 基础 URL
 *
 * @returns API 基础 URL
 */
function getConfiguredApiBaseURL(): string | undefined {
  return process.env.API_BASE_URL?.trim() || undefined;
}

export function hasConfiguredApiBaseURL(): boolean {
  return Boolean(getConfiguredApiBaseURL());
}

function isLocalPreviewHost(hostname: string): boolean {
  return hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '0.0.0.0' ||
    hostname === '[::1]' ||
    hostname === '::1';
}

function getLocalPreviewApiBaseURL(): string | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }

  return isLocalPreviewHost(window.location.hostname)
    ? 'http://127.0.0.1:3000/api/v1'
    : undefined;
}

function getApiBaseURL(): string {
  // 优先使用环境变量
  const configuredBaseURL = getConfiguredApiBaseURL();
  if (configuredBaseURL) {
    return configuredBaseURL;
  }

  // 开发环境默认值
  if (process.env.NODE_ENV === 'development') {
    return '/api/v1';
  }

  // 本地预览生产构建时，避免误打不可用的线上 API 域名
  const localPreviewBaseURL = getLocalPreviewApiBaseURL();
  if (localPreviewBaseURL) {
    return localPreviewBaseURL;
  }

  // 生产环境默认值
  return 'https://api.reffo.app/api/v1';
}

/**
 * 默认 API 客户端实例
 *
 * 提供一个全局单例，方便在应用中直接使用
 *
 * @example
 * ```typescript
 * import { apiClient } from '@/services/api'
 *
 * // 直接使用
 * const data = await apiClient.get('/mvp/health')
 * ```
 */
export const apiClient = new ApiClient({
  baseURL: getApiBaseURL(),
  timeout: 30000,
  enableLog: process.env.NODE_ENV === 'development',
});
