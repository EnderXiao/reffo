import {describe, test, expect, beforeEach, jest} from '@jest/globals';
import Taro from '@tarojs/taro';
import {TaroRequestAdapter, RequestError} from '../request';

// Mock Taro API
jest.mock('@tarojs/taro', () => ({
  request: jest.fn(),
}));

describe('TaroRequestAdapter', () => {
  let adapter: TaroRequestAdapter;

  beforeEach(() => {
    jest.clearAllMocks();
    adapter = new TaroRequestAdapter();
  });

  describe('基础请求功能', () => {
    test('应该成功发起 GET 请求', async () => {
      const mockData = {id: 1, name: '测试'};
      (Taro.request as jest.Mock).mockResolvedValue({
        data: mockData,
        statusCode: 200,
        header: {},
      });

      const response = await adapter.request({
        url: 'https://api.example.com/data',
        method: 'GET',
      });

      expect(response.success).toBe(true);
      expect(response.statusCode).toBe(200);
      expect(response.data).toEqual(mockData);
    });

    test('应该成功发起 POST 请求', async () => {
      const requestData = {name: '张三'};
      const responseData = {id: 1, ...requestData};

      (Taro.request as jest.Mock).mockResolvedValue({
        data: responseData,
        statusCode: 200,
        header: {},
      });

      const response = await adapter.request({
        url: 'https://api.example.com/users',
        method: 'POST',
        data: requestData,
      });

      expect(response.success).toBe(true);
      expect(response.data).toEqual(responseData);
    });

    test('应该使用默认配置', async () => {
      (Taro.request as jest.Mock).mockResolvedValue({
        data: {},
        statusCode: 200,
        header: {},
      });

      await adapter.request({
        url: 'https://api.example.com/data',
      });

      const callArgs = (Taro.request as jest.Mock).mock.calls[0][0];
      expect(callArgs.method).toBe('GET');
      expect(callArgs.timeout).toBe(30000);
    });
  });

  describe('错误处理', () => {
    test('应该处理 HTTP 错误状态码', async () => {
      (Taro.request as jest.Mock).mockResolvedValue({
        data: {error: 'Not Found'},
        statusCode: 404,
        header: {},
      });

      await expect(
        adapter.request({
          url: 'https://api.example.com/data',
        }),
      ).rejects.toThrow('HTTP 错误');
    });

    test('应该处理网络超时', async () => {
      (Taro.request as jest.Mock).mockRejectedValue({
        errMsg: 'request:fail timeout',
      });

      try {
        await adapter.request({
          url: 'https://api.example.com/data',
        });
        expect(true).toBe(false);
      } catch (error) {
        expect(error).toBeInstanceOf(RequestError);
        expect((error as RequestError).code).toBe('TIMEOUT');
      }
    });

    test('应该处理网络连接失败', async () => {
      (Taro.request as jest.Mock).mockRejectedValue({
        errMsg: 'request:fail',
      });

      try {
        await adapter.request({
          url: 'https://api.example.com/data',
        });
        expect(true).toBe(false);
      } catch (error) {
        expect(error).toBeInstanceOf(RequestError);
        expect((error as RequestError).code).toBe('NETWORK_ERROR');
      }
    });
  });

  describe('取消请求', () => {
    test('AbortSignal 取消时返回 CANCELLED 且调用底层 abort', async () => {
      let resolveRequest: (value: unknown) => void = () => undefined
      const abort = jest.fn()
      ;(Taro.request as jest.Mock).mockReturnValue(Object.assign(
        new Promise(resolve => { resolveRequest = resolve }),
        {abort},
      ))
      const controller = new AbortController()
      const promise = adapter.request({url: 'https://api.example.com/data', signal: controller.signal})
      controller.abort()

      await expect(promise).rejects.toMatchObject({code: 'CANCELLED'})
      expect(abort).toHaveBeenCalledTimes(1)
      resolveRequest({data: {}, statusCode: 200, header: {}})
    })
  })

  describe('快捷方法', () => {
    test('get() 应该发起 GET 请求', async () => {
      (Taro.request as jest.Mock).mockResolvedValue({
        data: {id: 1},
        statusCode: 200,
        header: {},
      });

      const response = await adapter.get('/api/data');

      expect(response.data).toEqual({id: 1});
    });

    test('post() 应该发起 POST 请求', async () => {
      (Taro.request as jest.Mock).mockResolvedValue({
        data: {id: 1},
        statusCode: 200,
        header: {},
      });

      const data = {name: '张三'};
      await adapter.post('/api/users', data);

      const callArgs = (Taro.request as jest.Mock).mock.calls[0][0];
      expect(callArgs.method).toBe('POST');
      expect(callArgs.data).toEqual(data);
    });
  });

  describe('Property: 平台兼容性一致性', () => {
    test('不同平台应该返回相同的数据结构', async () => {
      const mockData = {
        id: 1,
        name: '测试数据',
        items: [1, 2, 3],
      };

      (Taro.request as jest.Mock).mockResolvedValue({
        data: mockData,
        statusCode: 200,
        header: {'content-type': 'application/json'},
      });

      const response = await adapter.request({
        url: 'https://api.example.com/data',
        method: 'GET',
      });

      // 验证响应结构
      expect(response).toHaveProperty('data');
      expect(response).toHaveProperty('statusCode');
      expect(response).toHaveProperty('header');
      expect(response).toHaveProperty('success');

      // 验证数据类型
      expect(typeof response.statusCode).toBe('number');
      expect(typeof response.success).toBe('boolean');

      // 验证数据内容
      expect(response.data).toEqual(mockData);
      expect(response.statusCode).toBe(200);
      expect(response.success).toBe(true);
    });
  });
});
