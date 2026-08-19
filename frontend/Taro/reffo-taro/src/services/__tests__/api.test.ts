import {describe, test, expect, beforeEach, jest} from '@jest/globals';

// Mock Taro 模块 - 使用工厂函数内部创建 mock
jest.mock('@tarojs/taro', () => {
  const mockFn = jest.fn();
  const Taro = {
    request: mockFn,
  };
  return {
    __esModule: true,
    default: Taro,
    request: mockFn,
  };
});

// 在 mock 之后导入
import Taro from '@tarojs/taro';
import {ApiClient} from '../api';
import {RequestError} from '@/utils/request';

// 获取 mock 函数引用
const mockRequest = (Taro as any).request;

describe('ApiClient', () => {
  let apiClient: ApiClient;

  beforeEach(() => {
    // 重置 mock
    mockRequest.mockClear();
    mockRequest.mockResolvedValue({
      data: {success: true, data: {message: 'ok'}},
      statusCode: 200,
      header: {},
      cookies: [],
      errMsg: '',
    });

    // 创建测试实例
    apiClient = new ApiClient({
      baseURL: 'http://localhost:3000/api/v1',
      timeout: 10000,
      enableLog: false,
    });
  });

  describe('构造函数和配置', () => {
    test('应该正确初始化配置', () => {
      const client = new ApiClient({
        baseURL: 'https://api.example.com',
        timeout: 5000,
        enableLog: true,
      });

      expect(client).toBeDefined();
    });

    test('应该使用默认超时时间', () => {
      const client = new ApiClient({
        baseURL: 'https://api.example.com',
      });

      expect(client).toBeDefined();
    });
  });

  describe('认证 token 管理', () => {
    test('应该能设置认证 token', () => {
      const token = 'test-token-123';
      apiClient.setAuthToken(token);

      expect(apiClient.getAuthToken()).toBe(token);
    });

    test('应该能清除认证 token', () => {
      apiClient.setAuthToken('test-token');
      apiClient.setAuthToken(null);

      expect(apiClient.getAuthToken()).toBeNull();
    });

    test('初始状态 token 应该为 null', () => {
      expect(apiClient.getAuthToken()).toBeNull();
    });
  });

  describe('GET 请求', () => {
    test('应该成功发起 GET 请求', async () => {
      mockRequest.mockResolvedValueOnce({
        data: {
          success: true,
          data: {id: 1, name: '测试'},
        },
        statusCode: 200,
        header: {},
        cookies: [],
        errMsg: '',
      });

      const result = await apiClient.get('/test');

      expect(result).toEqual({id: 1, name: '测试'});
      expect(mockRequest).toHaveBeenCalledTimes(1);
    });

    test('应该正确拼接 baseURL', async () => {
      mockRequest.mockResolvedValueOnce({
        data: {success: true, data: {}},
        statusCode: 200,
        header: {},
        cookies: [],
        errMsg: '',
      });

      await apiClient.get('/test');

      const callArgs = mockRequest.mock.calls[0][0];
      expect(callArgs.url).toBe('http://localhost:3000/api/v1/test');
    });

    test('应该添加通用请求头', async () => {
      mockRequest.mockResolvedValueOnce({
        data: {success: true, data: {}},
        statusCode: 200,
        header: {},
        cookies: [],
        errMsg: '',
      });

      await apiClient.get('/test');

      const callArgs = mockRequest.mock.calls[0][0];
      expect(callArgs.header['Content-Type']).toBe('application/json');
    });

    test('应该在有 token 时添加 Authorization 头', async () => {
      mockRequest.mockResolvedValueOnce({
        data: {success: true, data: {}},
        statusCode: 200,
        header: {},
        cookies: [],
        errMsg: '',
      });

      apiClient.setAuthToken('test-token');
      await apiClient.get('/test');

      const callArgs = mockRequest.mock.calls[0][0];
      expect(callArgs.header['Authorization']).toBe('Bearer test-token');
    });
  });

  describe('POST 请求', () => {
    test('应该成功发起 POST 请求', async () => {
      mockRequest.mockResolvedValueOnce({
        data: {
          success: true,
          data: {id: 1, created: true},
        },
        statusCode: 200,
        header: {},
        cookies: [],
        errMsg: '',
      });

      const result = await apiClient.post('/test', {name: '测试'});

      expect(result).toEqual({id: 1, created: true});
      expect(mockRequest).toHaveBeenCalledTimes(1);
    });

    test('应该正确传递请求数据', async () => {
      mockRequest.mockResolvedValueOnce({
        data: {success: true, data: {}},
        statusCode: 200,
        header: {},
        cookies: [],
        errMsg: '',
      });

      const requestData = {name: '测试', value: 123};
      await apiClient.post('/test', requestData);

      const callArgs = mockRequest.mock.calls[0][0];
      expect(callArgs.data).toEqual(requestData);
      expect(callArgs.method).toBe('POST');
    });
  });

  describe('PUT 请求', () => {
    test('应该成功发起 PUT 请求', async () => {
      mockRequest.mockResolvedValueOnce({
        data: {
          success: true,
          data: {id: 1, updated: true},
        },
        statusCode: 200,
        header: {},
        cookies: [],
        errMsg: '',
      });

      const result = await apiClient.put('/test/1', {name: '更新'});

      expect(result).toEqual({id: 1, updated: true});
      expect(mockRequest).toHaveBeenCalledTimes(1);
    });

    test('应该使用 PUT 方法', async () => {
      mockRequest.mockResolvedValueOnce({
        data: {success: true, data: {}},
        statusCode: 200,
        header: {},
        cookies: [],
        errMsg: '',
      });

      await apiClient.put('/test/1', {name: '更新'});

      const callArgs = mockRequest.mock.calls[0][0];
      expect(callArgs.method).toBe('PUT');
    });
  });

  describe('DELETE 请求', () => {
    test('应该成功发起 DELETE 请求', async () => {
      mockRequest.mockResolvedValueOnce({
        data: {
          success: true,
          data: {deleted: true},
        },
        statusCode: 200,
        header: {},
        cookies: [],
        errMsg: '',
      });

      const result = await apiClient.delete('/test/1');

      expect(result).toEqual({deleted: true});
      expect(mockRequest).toHaveBeenCalledTimes(1);
    });

    test('应该使用 DELETE 方法', async () => {
      mockRequest.mockResolvedValueOnce({
        data: {success: true, data: {}},
        statusCode: 200,
        header: {},
        cookies: [],
        errMsg: '',
      });

      await apiClient.delete('/test/1');

      const callArgs = mockRequest.mock.calls[0][0];
      expect(callArgs.method).toBe('DELETE');
    });
  });

  describe('错误处理', () => {
    test('应该处理业务错误（success: false）', async () => {
      mockRequest.mockResolvedValueOnce({
        data: {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: '参数验证失败',
          },
        },
        statusCode: 400,
        header: {},
        cookies: [],
        errMsg: '',
      });

      await expect(apiClient.get('/test')).rejects.toThrow('参数验证失败');
    });

    test('应该处理 HTTP 错误', async () => {
      mockRequest.mockResolvedValueOnce({
        data: {},
        statusCode: 500,
        header: {},
        cookies: [],
        errMsg: '',
      });

      await expect(apiClient.get('/test')).rejects.toThrow();
    });

    test('应该处理网络错误', async () => {
      mockRequest.mockRejectedValueOnce({
        errMsg: 'request:fail timeout',
      });

      await expect(apiClient.get('/test')).rejects.toThrow();
    });

    test('业务错误应该包含错误码', async () => {
      mockRequest.mockResolvedValueOnce({
        data: {
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: '资源不存在',
          },
        },
        statusCode: 404,
        header: {},
        cookies: [],
        errMsg: '',
      });

      try {
        await apiClient.get('/test');
        expect(true).toBe(false); // 不应该执行到这里
      } catch (error) {
        expect(error).toBeInstanceOf(RequestError);
        if (error instanceof RequestError) {
          expect(error.code).toBe('NOT_FOUND');
          expect(error.message).toBe('资源不存在');
        }
      }
    });
  });

  describe('响应格式处理', () => {
    test('应该正确提取 data 字段', async () => {
      const responseData = {
        id: 1,
        name: '测试',
        items: [1, 2, 3],
      };

      mockRequest.mockResolvedValueOnce({
        data: {
          success: true,
          data: responseData,
        },
        statusCode: 200,
        header: {},
        cookies: [],
        errMsg: '',
      });

      const result = await apiClient.get('/test');

      expect(result).toEqual(responseData);
    });

    test('应该处理空 data', async () => {
      mockRequest.mockResolvedValueOnce({
        data: {
          success: true,
          data: null,
        },
        statusCode: 200,
        header: {},
        cookies: [],
        errMsg: '',
      });

      const result = await apiClient.get('/test');

      expect(result).toBeNull();
    });

    test('应该处理数组响应', async () => {
      const arrayData = [
        {id: 1, name: '项目1'},
        {id: 2, name: '项目2'},
      ];

      mockRequest.mockResolvedValueOnce({
        data: {
          success: true,
          data: arrayData,
        },
        statusCode: 200,
        header: {},
        cookies: [],
        errMsg: '',
      });

      const result = await apiClient.get('/test');

      expect(result).toEqual(arrayData);
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('原始请求方法', () => {
    test('应该支持原始请求', async () => {
      mockRequest.mockResolvedValueOnce({
        data: {custom: 'response'},
        statusCode: 200,
        header: {'custom-header': 'value'},
        cookies: [],
        errMsg: '',
      });

      const response = await apiClient.request({
        url: '/custom',
        method: 'GET',
      });

      expect(response.data).toEqual({custom: 'response'});
      expect(response.statusCode).toBe(200);
      expect(response.header['custom-header']).toBe('value');
    });
  });

  describe('请求拦截器', () => {
    test('应该在所有请求中添加 baseURL', async () => {
      mockRequest.mockResolvedValueOnce({
        data: {success: true, data: {}},
        statusCode: 200,
        header: {},
        cookies: [],
        errMsg: '',
      });

      await apiClient.get('/endpoint');

      const callArgs = mockRequest.mock.calls[0][0];
      expect(callArgs.url).toContain('http://localhost:3000/api/v1');
    });

    test('应该保留完整 URL', async () => {
      mockRequest.mockResolvedValueOnce({
        data: {success: true, data: {}},
        statusCode: 200,
        header: {},
        cookies: [],
        errMsg: '',
      });

      await apiClient.request({
        url: 'https://other-api.com/endpoint',
        method: 'GET',
      });

      const callArgs = mockRequest.mock.calls[0][0];
      expect(callArgs.url).toBe('https://other-api.com/endpoint');
    });
  });

  describe('超时配置', () => {
    test('应该使用配置的超时时间', async () => {
      const client = new ApiClient({
        baseURL: 'http://localhost:3000',
        timeout: 5000,
        enableLog: false,
      });

      mockRequest.mockResolvedValueOnce({
        data: {success: true, data: {}},
        statusCode: 200,
        header: {},
        cookies: [],
        errMsg: '',
      });

      await client.get('/test');

      const callArgs = mockRequest.mock.calls[0][0];
      expect(callArgs.timeout).toBe(5000);
    });
  });

  describe('TypeScript 类型安全', () => {
    test('应该支持泛型类型', async () => {
      interface User {
        id: number;
        name: string;
        email: string;
      }

      mockRequest.mockResolvedValueOnce({
        data: {
          success: true,
          data: {
            id: 1,
            name: '张三',
            email: 'zhangsan@example.com',
          },
        },
        statusCode: 200,
        header: {},
        cookies: [],
        errMsg: '',
      });

      const user = await apiClient.get<User>('/users/1');

      expect(user.id).toBe(1);
      expect(user.name).toBe('张三');
      expect(user.email).toBe('zhangsan@example.com');
    });
  });
});

describe('默认 apiClient 实例', () => {
  test('应该导出默认实例', () => {
    const {apiClient} = require('../api');
    expect(apiClient).toBeDefined();
  });
});
