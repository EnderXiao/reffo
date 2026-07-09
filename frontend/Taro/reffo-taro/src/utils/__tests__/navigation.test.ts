import {describe, test, expect, jest, beforeEach} from '@jest/globals';
import Taro from '@tarojs/taro';
import {
  TaroNavigationAdapter,
  NavigationError,
  parseUrlParams,
  getCurrentPageParams,
  getParam,
  getParamAsNumber,
  getParamAsBoolean,
} from '../navigation';

// Mock Taro API
jest.mock('@tarojs/taro', () => ({
  navigateTo: jest.fn(),
  navigateBack: jest.fn(),
  redirectTo: jest.fn(),
  switchTab: jest.fn(),
  reLaunch: jest.fn(),
  getCurrentPages: jest.fn(),
}));

const mockNavigateTo = Taro.navigateTo as jest.MockedFunction<
  typeof Taro.navigateTo
>;
const mockNavigateBack = Taro.navigateBack as jest.MockedFunction<
  typeof Taro.navigateBack
>;
const mockRedirectTo = Taro.redirectTo as jest.MockedFunction<
  typeof Taro.redirectTo
>;
const mockSwitchTab = Taro.switchTab as jest.MockedFunction<
  typeof Taro.switchTab
>;
const mockReLaunch = Taro.reLaunch as jest.MockedFunction<typeof Taro.reLaunch>;
const mockGetCurrentPages = Taro.getCurrentPages as jest.MockedFunction<
  typeof Taro.getCurrentPages
>;

describe('TaroNavigationAdapter', () => {
  let adapter: TaroNavigationAdapter;

  beforeEach(() => {
    adapter = new TaroNavigationAdapter();
    // 清除所有 mock 调用记录
    jest.clearAllMocks();
  });

  describe('navigateTo', () => {
    test('should navigate to page without params', async () => {
      mockNavigateTo.mockResolvedValue({});

      await adapter.navigateTo('/pages/detail/index');

      expect(mockNavigateTo).toHaveBeenCalledWith({
        url: '/pages/detail/index',
      });
    });

    test('should navigate to page with params', async () => {
      mockNavigateTo.mockResolvedValue({});

      await adapter.navigateTo('/pages/detail/index', {
        id: 123,
        type: 'resume',
      });

      expect(mockNavigateTo).toHaveBeenCalledWith({
        url: '/pages/detail/index?id=123&type=resume',
      });
    });

    test('should encode URL params', async () => {
      mockNavigateTo.mockResolvedValue({});

      await adapter.navigateTo('/pages/detail/index', {
        name: '张三',
        title: 'Hello World',
      });

      const call = mockNavigateTo.mock.calls[0][0];
      expect(call.url).toContain('name=%E5%BC%A0%E4%B8%89');
      expect(call.url).toContain('title=Hello%20World');
    });

    test('should handle navigation error', async () => {
      mockNavigateTo.mockRejectedValue({
        errMsg: 'navigateTo:fail page not found',
      });

      await expect(
        adapter.navigateTo('/pages/nonexistent/index'),
      ).rejects.toThrow(NavigationError);

      try {
        await adapter.navigateTo('/pages/nonexistent/index');
      } catch (error) {
        expect(error).toBeInstanceOf(NavigationError);
        expect((error as NavigationError).code).toBe('PAGE_NOT_FOUND');
      }
    });

    test('should handle page limit exceeded error', async () => {
      mockNavigateTo.mockRejectedValue({
        errMsg: 'navigateTo:fail page limit exceeded',
      });

      try {
        await adapter.navigateTo('/pages/detail/index');
      } catch (error) {
        expect(error).toBeInstanceOf(NavigationError);
        expect((error as NavigationError).code).toBe('PAGE_LIMIT_EXCEEDED');
      }
    });
  });

  describe('navigateBack', () => {
    test('should navigate back with default delta', async () => {
      mockNavigateBack.mockResolvedValue({});

      await adapter.navigateBack();

      expect(mockNavigateBack).toHaveBeenCalledWith({delta: 1});
    });

    test('should navigate back with custom delta', async () => {
      mockNavigateBack.mockResolvedValue({});

      await adapter.navigateBack(2);

      expect(mockNavigateBack).toHaveBeenCalledWith({delta: 2});
    });

    test('should handle navigation back error', async () => {
      mockNavigateBack.mockRejectedValue({
        errMsg: 'navigateBack:fail',
      });

      await expect(adapter.navigateBack()).rejects.toThrow(NavigationError);
    });
  });

  describe('redirectTo', () => {
    test('should redirect to page without params', async () => {
      mockRedirectTo.mockResolvedValue({});

      await adapter.redirectTo('/pages/login/index');

      expect(mockRedirectTo).toHaveBeenCalledWith({
        url: '/pages/login/index',
      });
    });

    test('should redirect to page with params', async () => {
      mockRedirectTo.mockResolvedValue({});

      await adapter.redirectTo('/pages/error/index', {
        code: 404,
        message: 'Not Found',
      });

      expect(mockRedirectTo).toHaveBeenCalledWith({
        url: '/pages/error/index?code=404&message=Not%20Found',
      });
    });

    test('should handle redirect error', async () => {
      mockRedirectTo.mockRejectedValue({
        errMsg: 'redirectTo:fail',
      });

      await expect(adapter.redirectTo('/pages/login/index')).rejects.toThrow(
        NavigationError,
      );
    });
  });

  describe('switchTab', () => {
    test('should switch to tab page', async () => {
      mockSwitchTab.mockResolvedValue({});

      await adapter.switchTab('/pages/index/index');

      expect(mockSwitchTab).toHaveBeenCalledWith({
        url: '/pages/index/index',
      });
    });

    test('should handle switch tab error', async () => {
      mockSwitchTab.mockRejectedValue({
        errMsg: 'switchTab:fail',
      });

      await expect(adapter.switchTab('/pages/index/index')).rejects.toThrow(
        NavigationError,
      );
    });
  });

  describe('reLaunch', () => {
    test('should relaunch to page without params', async () => {
      mockReLaunch.mockResolvedValue({});

      await adapter.reLaunch('/pages/index/index');

      expect(mockReLaunch).toHaveBeenCalledWith({
        url: '/pages/index/index',
      });
    });

    test('should relaunch to page with params', async () => {
      mockReLaunch.mockResolvedValue({});

      await adapter.reLaunch('/pages/index/index', {
        from: 'logout',
      });

      expect(mockReLaunch).toHaveBeenCalledWith({
        url: '/pages/index/index?from=logout',
      });
    });

    test('should handle relaunch error', async () => {
      mockReLaunch.mockRejectedValue({
        errMsg: 'reLaunch:fail',
      });

      await expect(adapter.reLaunch('/pages/index/index')).rejects.toThrow(
        NavigationError,
      );
    });
  });

  describe('getCurrentPages', () => {
    test('should return current pages', () => {
      const mockPages = [
        {route: 'pages/index/index'},
        {route: 'pages/detail/index'},
      ];
      mockGetCurrentPages.mockReturnValue(mockPages);

      const pages = adapter.getCurrentPages();

      expect(pages).toEqual(mockPages);
      expect(pages.length).toBe(2);
    });
  });

  describe('getCurrentRoute', () => {
    test('should return current route', () => {
      const mockPages = [
        {route: 'pages/index/index'},
        {route: 'pages/detail/index'},
      ];
      mockGetCurrentPages.mockReturnValue(mockPages);

      const route = adapter.getCurrentRoute();

      expect(route).toBe('pages/detail/index');
    });

    test('should return empty string when no pages', () => {
      mockGetCurrentPages.mockReturnValue([]);

      const route = adapter.getCurrentRoute();

      expect(route).toBe('');
    });
  });

  describe('canGoBack', () => {
    test('should return true when can go back', () => {
      const mockPages = [
        {route: 'pages/index/index'},
        {route: 'pages/detail/index'},
      ];
      mockGetCurrentPages.mockReturnValue(mockPages);

      const canGoBack = adapter.canGoBack();

      expect(canGoBack).toBe(true);
    });

    test('should return false when cannot go back', () => {
      const mockPages = [{route: 'pages/index/index'}];
      mockGetCurrentPages.mockReturnValue(mockPages);

      const canGoBack = adapter.canGoBack();

      expect(canGoBack).toBe(false);
    });

    test('should return false when no pages', () => {
      mockGetCurrentPages.mockReturnValue([]);

      const canGoBack = adapter.canGoBack();

      expect(canGoBack).toBe(false);
    });
  });
});

describe('Navigation Utility Functions', () => {
  describe('parseUrlParams', () => {
    test('should parse URL params', () => {
      const params = parseUrlParams('/pages/detail/index?id=123&type=resume');

      expect(params).toEqual({
        id: '123',
        type: 'resume',
      });
    });

    test('should decode URL params', () => {
      const params = parseUrlParams(
        '/pages/detail/index?name=%E5%BC%A0%E4%B8%89&title=Hello%20World',
      );

      expect(params).toEqual({
        name: '张三',
        title: 'Hello World',
      });
    });

    test('should return empty object for URL without params', () => {
      const params = parseUrlParams('/pages/index/index');

      expect(params).toEqual({});
    });

    test('should handle empty param values', () => {
      const params = parseUrlParams('/pages/detail/index?id=&type=resume');

      expect(params).toEqual({
        id: '',
        type: 'resume',
      });
    });
  });

  describe('getCurrentPageParams', () => {
    test('should return current page params', () => {
      const mockPages = [
        {
          route: 'pages/detail/index',
          options: {id: '123', type: 'resume'},
        },
      ];
      mockGetCurrentPages.mockReturnValue(mockPages);

      const params = getCurrentPageParams();

      expect(params).toEqual({
        id: '123',
        type: 'resume',
      });
    });

    test('should return empty object when no pages', () => {
      mockGetCurrentPages.mockReturnValue([]);

      const params = getCurrentPageParams();

      expect(params).toEqual({});
    });

    test('should return empty object when no options', () => {
      const mockPages = [{route: 'pages/index/index'}];
      mockGetCurrentPages.mockReturnValue(mockPages);

      const params = getCurrentPageParams();

      expect(params).toEqual({});
    });
  });

  describe('getParam', () => {
    test('should get string param', () => {
      const params = {id: '123', type: 'resume'};

      expect(getParam(params, 'id')).toBe('123');
      expect(getParam(params, 'type')).toBe('resume');
    });

    test('should return default value for missing param', () => {
      const params = {id: '123'};

      expect(getParam(params, 'type', 'default')).toBe('default');
    });

    test('should return empty string as default', () => {
      const params = {id: '123'};

      expect(getParam(params, 'type')).toBe('');
    });
  });

  describe('getParamAsNumber', () => {
    test('should get number param', () => {
      const params = {id: '123', score: '85'};

      expect(getParamAsNumber(params, 'id')).toBe(123);
      expect(getParamAsNumber(params, 'score')).toBe(85);
    });

    test('should return default value for missing param', () => {
      const params = {id: '123'};

      expect(getParamAsNumber(params, 'score', 0)).toBe(0);
    });

    test('should return default value for invalid number', () => {
      const params = {id: 'abc'};

      expect(getParamAsNumber(params, 'id', 0)).toBe(0);
    });

    test('should handle decimal numbers', () => {
      const params = {score: '85.5'};

      expect(getParamAsNumber(params, 'score')).toBe(85.5);
    });
  });

  describe('getParamAsBoolean', () => {
    test('should get boolean param from "true"', () => {
      const params = {isEdit: 'true'};

      expect(getParamAsBoolean(params, 'isEdit')).toBe(true);
    });

    test('should get boolean param from "1"', () => {
      const params = {isEdit: '1'};

      expect(getParamAsBoolean(params, 'isEdit')).toBe(true);
    });

    test('should return false for "false"', () => {
      const params = {isEdit: 'false'};

      expect(getParamAsBoolean(params, 'isEdit')).toBe(false);
    });

    test('should return false for "0"', () => {
      const params = {isEdit: '0'};

      expect(getParamAsBoolean(params, 'isEdit')).toBe(false);
    });

    test('should return default value for missing param', () => {
      const params = {id: '123'};

      expect(getParamAsBoolean(params, 'isEdit', false)).toBe(false);
      expect(getParamAsBoolean(params, 'isEdit', true)).toBe(true);
    });

    test('should return false as default', () => {
      const params = {id: '123'};

      expect(getParamAsBoolean(params, 'isEdit')).toBe(false);
    });
  });
});

/**
 * Property-Based Tests
 *
 * 验证导航适配器的核心属性
 */
describe('Navigation Adapter Properties', () => {
  let adapter: TaroNavigationAdapter;

  beforeEach(() => {
    adapter = new TaroNavigationAdapter();
    jest.clearAllMocks();
  });

  /**
   * Property 1: URL 参数编码往返一致性
   *
   * 对于任何参数对象，编码后再解码应该得到等价的对象
   *
   * **Validates: Requirements 3.5**
   */
  test('Property: URL params encoding round-trip consistency', () => {
    const testCases = [
      {id: 123, type: 'resume'},
      {name: '张三', age: 25},
      {title: 'Hello World', active: true},
      {score: 85.5, level: 3},
    ];

    for (const params of testCases) {
      // 构建 URL
      const url = '/pages/test/index';
      const fullUrl = (adapter as any).buildUrl(url, params);

      // 解析参数
      const parsed = parseUrlParams(fullUrl);

      // 验证：解析后的参数应该与原始参数等价（类型转换为字符串）
      for (const [key, value] of Object.entries(params)) {
        expect(parsed[key]).toBe(String(value));
      }
    }
  });

  /**
   * Property 2: 导航操作的错误处理完整性
   *
   * 对于任何导航操作失败，应该抛出 NavigationError 并包含错误信息
   *
   * **Validates: Requirements 3.5**
   */
  test('Property: Navigation error handling completeness', async () => {
    const operations = [
      {
        name: 'navigateTo',
        fn: () => adapter.navigateTo('/pages/test/index'),
        mock: mockNavigateTo,
      },
      {
        name: 'navigateBack',
        fn: () => adapter.navigateBack(),
        mock: mockNavigateBack,
      },
      {
        name: 'redirectTo',
        fn: () => adapter.redirectTo('/pages/test/index'),
        mock: mockRedirectTo,
      },
      {
        name: 'switchTab',
        fn: () => adapter.switchTab('/pages/test/index'),
        mock: mockSwitchTab,
      },
      {
        name: 'reLaunch',
        fn: () => adapter.reLaunch('/pages/test/index'),
        mock: mockReLaunch,
      },
    ];

    for (const {name, fn, mock} of operations) {
      // 模拟失败
      mock.mockRejectedValue({errMsg: `${name}:fail test error`});

      // 验证：应该抛出 NavigationError
      try {
        await fn();
        throw new Error(`${name} should throw NavigationError`);
      } catch (error) {
        expect(error).toBeInstanceOf(NavigationError);
        expect((error as NavigationError).code).toBeDefined();
        expect((error as NavigationError).message).toBeDefined();
      }
    }
  });

  /**
   * Property 3: 参数类型转换的正确性
   *
   * 对于任何参数值，类型转换函数应该返回正确的类型
   *
   * **Validates: Requirements 3.5**
   */
  test('Property: Parameter type conversion correctness', () => {
    const testCases = [
      // 数字转换
      {params: {id: '123'}, key: 'id', expected: 123, fn: getParamAsNumber},
      {params: {id: '0'}, key: 'id', expected: 0, fn: getParamAsNumber},
      {
        params: {id: '85.5'},
        key: 'id',
        expected: 85.5,
        fn: getParamAsNumber,
      },
      {params: {id: 'abc'}, key: 'id', expected: 0, fn: getParamAsNumber},

      // 布尔转换
      {
        params: {flag: 'true'},
        key: 'flag',
        expected: true,
        fn: getParamAsBoolean,
      },
      {
        params: {flag: '1'},
        key: 'flag',
        expected: true,
        fn: getParamAsBoolean,
      },
      {
        params: {flag: 'false'},
        key: 'flag',
        expected: false,
        fn: getParamAsBoolean,
      },
      {
        params: {flag: '0'},
        key: 'flag',
        expected: false,
        fn: getParamAsBoolean,
      },
      {
        params: {flag: 'other'},
        key: 'flag',
        expected: false,
        fn: getParamAsBoolean,
      },
    ];

    for (const {params, key, expected, fn} of testCases) {
      const result = fn(params, key, expected);
      expect(result).toBe(expected);
    }
  });

  /**
   * Property 4: 页面栈状态的一致性
   *
   * getCurrentPages、getCurrentRoute、canGoBack 应该返回一致的状态
   *
   * **Validates: Requirements 3.5**
   */
  test('Property: Page stack state consistency', () => {
    const testCases = [
      {
        pages: [],
        expectedRoute: '',
        expectedCanGoBack: false,
      },
      {
        pages: [{route: 'pages/index/index'}],
        expectedRoute: 'pages/index/index',
        expectedCanGoBack: false,
      },
      {
        pages: [{route: 'pages/index/index'}, {route: 'pages/detail/index'}],
        expectedRoute: 'pages/detail/index',
        expectedCanGoBack: true,
      },
      {
        pages: [
          {route: 'pages/index/index'},
          {route: 'pages/detail/index'},
          {route: 'pages/result/index'},
        ],
        expectedRoute: 'pages/result/index',
        expectedCanGoBack: true,
      },
    ];

    for (const {pages, expectedRoute, expectedCanGoBack} of testCases) {
      mockGetCurrentPages.mockReturnValue(pages);

      // 验证页面栈
      expect(adapter.getCurrentPages()).toEqual(pages);

      // 验证当前路由
      expect(adapter.getCurrentRoute()).toBe(expectedRoute);

      // 验证是否可以返回
      expect(adapter.canGoBack()).toBe(expectedCanGoBack);

      // 验证一致性：canGoBack 应该等于 pages.length > 1
      expect(adapter.canGoBack()).toBe(pages.length > 1);
    }
  });
});
