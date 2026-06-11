import {describe, test, expect, jest, beforeEach} from '@jest/globals';
import {
  retry,
  withRetry,
  retryAll,
  retryUntil,
  RetryPresets,
  type RetryOptions,
} from '../retry';
import {createNetworkError, createTimeoutError, createApiError} from '../error';

describe('retry', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('基础功能', () => {
    test('成功时不重试', async () => {
      const fn = jest.fn().mockResolvedValue('success');

      const result = await retry(fn);

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    test('失败后重试直到成功', async () => {
      const fn = jest
        .fn()
        .mockRejectedValueOnce(createNetworkError())
        .mockRejectedValueOnce(createNetworkError())
        .mockResolvedValue('success');

      const result = await retry(fn, {maxRetries: 3, delay: 10});

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(3);
    });

    test('所有重试都失败时抛出最后的错误', async () => {
      const error = createNetworkError('Network failed');
      const fn = jest.fn().mockRejectedValue(error);

      await expect(retry(fn, {maxRetries: 2, delay: 10})).rejects.toThrow(
        'Network failed',
      );

      expect(fn).toHaveBeenCalledTimes(3); // 初始 + 2 次重试
    });

    test('maxRetries 为 0 时不重试', async () => {
      const fn = jest.fn().mockRejectedValue(createNetworkError());

      await expect(retry(fn, {maxRetries: 0})).rejects.toThrow();

      expect(fn).toHaveBeenCalledTimes(1);
    });
  });

  describe('退避策略', () => {
    test('固定延迟策略', async () => {
      const fn = jest
        .fn()
        .mockRejectedValueOnce(createNetworkError())
        .mockRejectedValueOnce(createNetworkError())
        .mockResolvedValue('success');

      const startTime = Date.now();
      await retry(fn, {
        maxRetries: 2,
        delay: 100,
        backoff: 'fixed',
      });
      const duration = Date.now() - startTime;

      // 应该有 2 次延迟，每次 100ms
      expect(duration).toBeGreaterThanOrEqual(200);
      expect(duration).toBeLessThan(300);
    });

    test('线性延迟策略', async () => {
      const fn = jest
        .fn()
        .mockRejectedValueOnce(createNetworkError())
        .mockRejectedValueOnce(createNetworkError())
        .mockResolvedValue('success');

      const startTime = Date.now();
      await retry(fn, {
        maxRetries: 2,
        delay: 100,
        backoff: 'linear',
      });
      const duration = Date.now() - startTime;

      // 第 1 次重试: 100ms, 第 2 次重试: 200ms
      expect(duration).toBeGreaterThanOrEqual(300);
      expect(duration).toBeLessThan(400);
    });

    test('指数延迟策略', async () => {
      const fn = jest
        .fn()
        .mockRejectedValueOnce(createNetworkError())
        .mockRejectedValueOnce(createNetworkError())
        .mockResolvedValue('success');

      const startTime = Date.now();
      await retry(fn, {
        maxRetries: 2,
        delay: 100,
        backoff: 'exponential',
      });
      const duration = Date.now() - startTime;

      // 第 1 次重试: 100ms, 第 2 次重试: 200ms
      expect(duration).toBeGreaterThanOrEqual(300);
      expect(duration).toBeLessThan(400);
    });

    test('最大延迟限制', async () => {
      const fn = jest
        .fn()
        .mockRejectedValueOnce(createNetworkError())
        .mockRejectedValueOnce(createNetworkError())
        .mockResolvedValue('success');

      const startTime = Date.now();
      await retry(fn, {
        maxRetries: 2,
        delay: 1000,
        backoff: 'exponential',
        maxDelay: 500, // 限制最大延迟为 500ms
      });
      const duration = Date.now() - startTime;

      // 两次延迟都应该被限制在 500ms
      expect(duration).toBeGreaterThanOrEqual(1000);
      expect(duration).toBeLessThan(1200);
    });
  });

  describe('重试条件', () => {
    test('默认只重试网络错误', async () => {
      const networkError = createNetworkError();
      const fn = jest.fn().mockRejectedValue(networkError);

      await expect(retry(fn, {maxRetries: 2, delay: 10})).rejects.toThrow();

      expect(fn).toHaveBeenCalledTimes(3); // 初始 + 2 次重试
    });

    test('默认只重试超时错误', async () => {
      const timeoutError = createTimeoutError();
      const fn = jest.fn().mockRejectedValue(timeoutError);

      await expect(retry(fn, {maxRetries: 2, delay: 10})).rejects.toThrow();

      expect(fn).toHaveBeenCalledTimes(3); // 初始 + 2 次重试
    });

    test('默认不重试 API 错误', async () => {
      const apiError = createApiError('API Error');
      const fn = jest.fn().mockRejectedValue(apiError);

      await expect(retry(fn, {maxRetries: 2, delay: 10})).rejects.toThrow();

      expect(fn).toHaveBeenCalledTimes(1); // 只执行一次，不重试
    });

    test('自定义重试条件', async () => {
      const apiError = createApiError('Temporary Error');
      const fn = jest
        .fn()
        .mockRejectedValueOnce(apiError)
        .mockResolvedValue('success');

      const result = await retry(fn, {
        maxRetries: 2,
        delay: 10,
        shouldRetry: error => {
          // 自定义条件：重试包含 "Temporary" 的错误
          return error.message.includes('Temporary');
        },
      });

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    test('shouldRetry 可以访问重试次数', async () => {
      const fn = jest.fn().mockRejectedValue(createNetworkError());
      const shouldRetry = jest.fn().mockReturnValue(true);

      await expect(
        retry(fn, {
          maxRetries: 3,
          delay: 10,
          shouldRetry,
        }),
      ).rejects.toThrow();

      // shouldRetry 应该被调用 3 次（每次重试前）
      expect(shouldRetry).toHaveBeenCalledTimes(3);
      expect(shouldRetry).toHaveBeenNthCalledWith(1, expect.any(Error), 1);
      expect(shouldRetry).toHaveBeenNthCalledWith(2, expect.any(Error), 2);
      expect(shouldRetry).toHaveBeenNthCalledWith(3, expect.any(Error), 3);
    });
  });

  describe('重试回调', () => {
    test('onRetry 回调被正确调用', async () => {
      const fn = jest
        .fn()
        .mockRejectedValueOnce(createNetworkError())
        .mockRejectedValueOnce(createNetworkError())
        .mockResolvedValue('success');

      const onRetry = jest.fn();

      await retry(fn, {
        maxRetries: 2,
        delay: 10,
        backoff: 'fixed',
        onRetry,
      });

      expect(onRetry).toHaveBeenCalledTimes(2);
      expect(onRetry).toHaveBeenNthCalledWith(1, expect.any(Error), 1, 10);
      expect(onRetry).toHaveBeenNthCalledWith(2, expect.any(Error), 2, 10);
    });
  });

  describe('withRetry', () => {
    test('创建带重试的函数', async () => {
      const fn = jest
        .fn()
        .mockRejectedValueOnce(createNetworkError())
        .mockResolvedValue('success');

      const fnWithRetry = withRetry(fn, {maxRetries: 2, delay: 10});

      const result = await fnWithRetry();

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    test('保留原函数的参数', async () => {
      const fn = jest.fn().mockResolvedValue('success');

      const fnWithRetry = withRetry(fn, {maxRetries: 2});

      await fnWithRetry('arg1', 'arg2', 'arg3');

      expect(fn).toHaveBeenCalledWith('arg1', 'arg2', 'arg3');
    });
  });

  describe('retryAll', () => {
    test('并发执行多个函数并重试', async () => {
      const fn1 = jest
        .fn()
        .mockRejectedValueOnce(createNetworkError())
        .mockResolvedValue('result1');

      const fn2 = jest.fn().mockResolvedValue('result2');

      const fn3 = jest
        .fn()
        .mockRejectedValueOnce(createNetworkError())
        .mockResolvedValue('result3');

      const results = await retryAll([fn1, fn2, fn3], {
        maxRetries: 2,
        delay: 10,
      });

      expect(results).toEqual(['result1', 'result2', 'result3']);
      expect(fn1).toHaveBeenCalledTimes(2);
      expect(fn2).toHaveBeenCalledTimes(1);
      expect(fn3).toHaveBeenCalledTimes(2);
    });

    test('一个函数失败不影响其他函数', async () => {
      const fn1 = jest.fn().mockResolvedValue('result1');
      const fn2 = jest.fn().mockRejectedValue(createNetworkError());
      const fn3 = jest.fn().mockResolvedValue('result3');

      await expect(
        retryAll([fn1, fn2, fn3], {maxRetries: 1, delay: 10}),
      ).rejects.toThrow();

      expect(fn1).toHaveBeenCalledTimes(1);
      expect(fn2).toHaveBeenCalledTimes(2); // 初始 + 1 次重试
      expect(fn3).toHaveBeenCalledTimes(1);
    });
  });

  describe('retryUntil', () => {
    test('重试直到条件满足', async () => {
      let count = 0;
      const fn = jest.fn().mockImplementation(() => {
        count++;
        return Promise.resolve({status: count >= 3 ? 'ready' : 'pending'});
      });

      const result = await retryUntil(fn, result => result.status === 'ready', {
        maxRetries: 5,
        delay: 10,
      });

      expect(result).toEqual({status: 'ready'});
      expect(fn).toHaveBeenCalledTimes(3);
    });

    test('条件始终不满足时抛出错误', async () => {
      const fn = jest.fn().mockResolvedValue({status: 'pending'});

      await expect(
        retryUntil(fn, result => result.status === 'ready', {
          maxRetries: 2,
          delay: 10,
        }),
      ).rejects.toThrow('Condition not met');

      expect(fn).toHaveBeenCalledTimes(3); // 初始 + 2 次重试
    });
  });

  describe('RetryPresets', () => {
    test('fast 预设配置', () => {
      expect(RetryPresets.fast).toEqual({
        maxRetries: 2,
        delay: 500,
        backoff: 'fixed',
      });
    });

    test('standard 预设配置', () => {
      expect(RetryPresets.standard).toEqual({
        maxRetries: 3,
        delay: 1000,
        backoff: 'exponential',
      });
    });

    test('persistent 预设配置', () => {
      expect(RetryPresets.persistent).toEqual({
        maxRetries: 5,
        delay: 2000,
        backoff: 'exponential',
        maxDelay: 30000,
      });
    });

    test('polling 预设配置', () => {
      expect(RetryPresets.polling).toEqual({
        maxRetries: 10,
        delay: 3000,
        backoff: 'fixed',
      });
    });

    test('使用预设配置', async () => {
      const fn = jest
        .fn()
        .mockRejectedValueOnce(createNetworkError())
        .mockResolvedValue('success');

      const result = await retry(fn, {
        ...RetryPresets.fast,
        delay: 10, // 覆盖延迟以加快测试
      });

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(2);
    });
  });

  describe('边界情况', () => {
    test('处理同步错误', async () => {
      const fn = jest.fn().mockImplementation(() => {
        throw new Error('Sync error');
      });

      await expect(retry(fn, {maxRetries: 2, delay: 10})).rejects.toThrow(
        'Sync error',
      );
    });

    test('处理 undefined 返回值', async () => {
      const fn = jest.fn().mockResolvedValue(undefined);

      const result = await retry(fn);

      expect(result).toBeUndefined();
      expect(fn).toHaveBeenCalledTimes(1);
    });

    test('处理 null 返回值', async () => {
      const fn = jest.fn().mockResolvedValue(null);

      const result = await retry(fn);

      expect(result).toBeNull();
      expect(fn).toHaveBeenCalledTimes(1);
    });

    test('处理非 Error 对象的拒绝', async () => {
      const fn = jest.fn().mockRejectedValue('string error');

      await expect(retry(fn, {maxRetries: 0})).rejects.toBe('string error');
    });
  });

  describe('性能测试', () => {
    test('延迟时间准确性', async () => {
      const fn = jest
        .fn()
        .mockRejectedValueOnce(createNetworkError())
        .mockResolvedValue('success');

      const delay = 100;
      const startTime = Date.now();

      await retry(fn, {
        maxRetries: 1,
        delay,
        backoff: 'fixed',
      });

      const duration = Date.now() - startTime;

      // 允许 ±20ms 的误差
      expect(duration).toBeGreaterThanOrEqual(delay - 20);
      expect(duration).toBeLessThan(delay + 50);
    });

    test('不会无限重试', async () => {
      const fn = jest.fn().mockRejectedValue(createNetworkError());

      const startTime = Date.now();

      await expect(
        retry(fn, {
          maxRetries: 3,
          delay: 10,
        }),
      ).rejects.toThrow();

      const duration = Date.now() - startTime;

      // 应该在合理时间内完成（不超过 1 秒）
      expect(duration).toBeLessThan(1000);
    });
  });
});
