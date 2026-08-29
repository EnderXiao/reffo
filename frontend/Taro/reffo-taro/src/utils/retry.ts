import {isNetworkError} from './error';

/**
 * 退避策略类型
 */
export type BackoffStrategy = 'linear' | 'exponential' | 'fixed';

/**
 * 重试配置接口
 */
export interface RetryOptions {
  /**
   * 最大重试次数
   * @default 3
   */
  maxRetries?: number;

  /**
   * 初始延迟时间（毫秒）
   * @default 1000
   */
  delay?: number;

  /**
   * 退避策略
   * - 'fixed': 固定延迟
   * - 'linear': 线性增长（delay * attempt）
   * - 'exponential': 指数增长（delay * 2^attempt）
   * @default 'exponential'
   */
  backoff?: BackoffStrategy;

  /**
   * 最大延迟时间（毫秒）
   * 用于限制指数退避的最大延迟
   * @default 30000
   */
  maxDelay?: number;

  /**
   * 判断是否应该重试的函数
   * @param error 错误对象
   * @param attempt 当前重试次数（从 1 开始）
   * @returns 是否应该重试
   * @default 网络错误和超时错误自动重试
   */
  shouldRetry?: (error: any, attempt: number) => boolean;

  /**
   * 重试前的回调函数
   * @param error 错误对象
   * @param attempt 当前重试次数（从 1 开始）
   * @param delay 延迟时间（毫秒）
   */
  onRetry?: (error: any, attempt: number, delay: number) => void;
}

/**
 * 默认的重试判断函数
 *
 * 网络错误和超时错误自动重试
 *
 * @param error 错误对象
 * @returns 是否应该重试
 */
function defaultShouldRetry(error: unknown): boolean {
  // 使用 error.ts 中的工具函数判断是否是网络错误
  if (isNetworkError(error)) return true
  if (!error || typeof error !== 'object') return false
  const code = (error as {code?: unknown}).code
  return code === 'NETWORK_ERROR' || code === 'TIMEOUT'
}

/**
 * 计算延迟时间
 *
 * 根据退避策略和当前重试次数计算延迟时间
 *
 * @param attempt 当前重试次数（从 1 开始）
 * @param options 重试配置
 * @returns 延迟时间（毫秒）
 */
function calculateDelay(
  attempt: number,
  options: Required<RetryOptions>,
): number {
  const {delay, backoff, maxDelay} = options;

  let calculatedDelay: number;

  switch (backoff) {
    case 'fixed':
      calculatedDelay = delay;
      break;

    case 'linear':
      calculatedDelay = delay * attempt;
      break;

    case 'exponential':
      calculatedDelay = delay * Math.pow(2, attempt - 1);
      break;

    default:
      calculatedDelay = delay;
  }

  // 限制最大延迟
  return Math.min(calculatedDelay, maxDelay);
}

/**
 * 延迟执行
 *
 * @param ms 延迟时间（毫秒）
 * @returns Promise
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 通用重试函数
 *
 * 对任何异步函数添加重试机制
 *
 * **特性：**
 * - 支持自定义重试次数
 * - 支持多种退避策略（固定、线性、指数）
 * - 支持自定义重试条件
 * - 支持重试回调
 * - 自动处理网络错误和超时错误
 *
 * **Validates: Requirements 7.5**
 *
 * @param fn 要执行的异步函数
 * @param options 重试配置
 * @returns Promise<T> 函数执行结果
 * @throws 当所有重试都失败后，抛出最后一次的错误
 *
 * @example
 * ```typescript
 * // 基础用法
 * const result = await retry(
 *   () => apiClient.get('/data'),
 *   { maxRetries: 3 }
 * )
 *
 * // 自定义退避策略
 * const result = await retry(
 *   () => apiClient.post('/submit', data),
 *   {
 *     maxRetries: 5,
 *     delay: 2000,
 *     backoff: 'exponential',
 *     maxDelay: 30000
 *   }
 * )
 *
 * // 自定义重试条件
 * const result = await retry(
 *   () => apiClient.get('/data'),
 *   {
 *     maxRetries: 3,
 *     shouldRetry: (error, attempt) => {
 *       // 只在特定错误码时重试
 *       return error.code === 'NETWORK_ERROR' && attempt < 3
 *     }
 *   }
 * )
 *
 * // 监听重试事件
 * const result = await retry(
 *   () => apiClient.get('/data'),
 *   {
 *     maxRetries: 3,
 *     onRetry: (error, attempt, delay) => {
 *       console.log(`第 ${attempt} 次重试，延迟 ${delay}ms`)
 *     }
 *   }
 * )
 * ```
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  // 合并默认配置
  const config: Required<RetryOptions> = {
    maxRetries: options.maxRetries ?? 3,
    delay: options.delay ?? 1000,
    backoff: options.backoff ?? 'exponential',
    maxDelay: options.maxDelay ?? 30000,
    shouldRetry: options.shouldRetry ?? defaultShouldRetry,
    onRetry: options.onRetry ?? (() => {}),
  };

  let lastError: any;
  let attempt = 0;

  while (attempt <= config.maxRetries) {
    try {
      // 第一次尝试或重试
      return await fn();
    } catch (error) {
      lastError = error;
      attempt++;

      // 检查是否还有重试机会
      if (attempt > config.maxRetries) {
        break;
      }

      // 检查是否应该重试
      if (!config.shouldRetry(error, attempt)) {
        break;
      }

      // 计算延迟时间
      const delayTime = calculateDelay(attempt, config);

      // 调用重试回调
      config.onRetry(error, attempt, delayTime);

      // 记录重试日志
      console.log('[Retry]', {
        attempt,
        maxRetries: config.maxRetries,
        delay: delayTime,
        error: error instanceof Error ? error.message : String(error),
      });

      // 延迟后重试
      await sleep(delayTime);
    }
  }

  // 所有重试都失败，抛出最后一次的错误
  throw lastError;
}

/**
 * 创建带重试的函数
 *
 * 返回一个新函数，该函数会自动重试
 *
 * @param fn 要包装的异步函数
 * @param options 重试配置
 * @returns 带重试功能的新函数
 *
 * @example
 * ```typescript
 * // 创建带重试的 API 调用函数
 * const fetchDataWithRetry = withRetry(
 *   () => apiClient.get('/data'),
 *   { maxRetries: 3 }
 * )
 *
 * // 使用
 * const data = await fetchDataWithRetry()
 * ```
 */
export function withRetry<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  options: RetryOptions = {},
): T {
  return ((...args: any[]) => {
    return retry(() => fn(...args), options);
  }) as T;
}

/**
 * 重试装饰器工厂
 *
 * 用于装饰类方法，自动添加重试功能
 *
 * @param options 重试配置
 * @returns 方法装饰器
 *
 * @example
 * ```typescript
 * class ApiService {
 *   @Retry({ maxRetries: 3 })
 *   async fetchData() {
 *     return await apiClient.get('/data')
 *   }
 * }
 * ```
 */
export function Retry(options: RetryOptions = {}) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor,
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      return retry(() => originalMethod.apply(this, args), options);
    };

    return descriptor;
  };
}

/**
 * 批量重试
 *
 * 对多个异步函数并发执行，每个函数都有独立的重试机制
 *
 * @param fns 异步函数数组
 * @param options 重试配置
 * @returns Promise<T[]> 所有函数的执行结果
 *
 * @example
 * ```typescript
 * const results = await retryAll(
 *   [
 *     () => apiClient.get('/data1'),
 *     () => apiClient.get('/data2'),
 *     () => apiClient.get('/data3')
 *   ],
 *   { maxRetries: 3 }
 * )
 * ```
 */
export async function retryAll<T>(
  fns: Array<() => Promise<T>>,
  options: RetryOptions = {},
): Promise<T[]> {
  return Promise.all(fns.map(fn => retry(fn, options)));
}

/**
 * 条件重试
 *
 * 根据条件判断是否需要重试，如果条件满足则返回结果，否则重试
 *
 * @param fn 要执行的异步函数
 * @param condition 条件判断函数，返回 true 表示成功，false 表示需要重试
 * @param options 重试配置
 * @returns Promise<T> 函数执行结果
 *
 * @example
 * ```typescript
 * // 轮询直到数据准备好
 * const data = await retryUntil(
 *   () => apiClient.get('/status'),
 *   (result) => result.status === 'ready',
 *   { maxRetries: 10, delay: 2000 }
 * )
 * ```
 */
export async function retryUntil<T>(
  fn: () => Promise<T>,
  condition: (result: T) => boolean,
  options: RetryOptions = {},
): Promise<T> {
  // 修改 shouldRetry 逻辑，让它总是重试（由条件判断决定）
  const modifiedOptions: RetryOptions = {
    ...options,
    shouldRetry: () => true, // 总是重试，直到条件满足或达到最大重试次数
  };

  return retry(async () => {
    const result = await fn();
    if (!condition(result)) {
      throw new Error('Condition not met');
    }
    return result;
  }, modifiedOptions);
}

/**
 * 预设的重试配置
 */
export const RetryPresets = {
  /**
   * 快速重试
   * - 最多重试 2 次
   * - 固定延迟 500ms
   */
  fast: {
    maxRetries: 2,
    delay: 500,
    backoff: 'fixed' as BackoffStrategy,
  },

  /**
   * 标准重试
   * - 最多重试 3 次
   * - 初始延迟 1000ms
   * - 指数退避
   */
  standard: {
    maxRetries: 3,
    delay: 1000,
    backoff: 'exponential' as BackoffStrategy,
  },

  /**
   * 持久重试
   * - 最多重试 5 次
   * - 初始延迟 2000ms
   * - 指数退避
   * - 最大延迟 30000ms
   */
  persistent: {
    maxRetries: 5,
    delay: 2000,
    backoff: 'exponential' as BackoffStrategy,
    maxDelay: 30000,
  },

  /**
   * 轮询重试
   * - 最多重试 10 次
   * - 固定延迟 3000ms
   */
  polling: {
    maxRetries: 10,
    delay: 3000,
    backoff: 'fixed' as BackoffStrategy,
  },
} as const;
