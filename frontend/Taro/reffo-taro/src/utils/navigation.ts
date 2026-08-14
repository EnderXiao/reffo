import Taro from '@tarojs/taro';
import {runWithNavigationTransition} from './navigation-transition';

/**
 * 导航参数类型
 *
 * 支持字符串、数字、布尔值等基本类型
 */
export type NavigationParams = Record<string, string | number | boolean>;

/**
 * 导航选项接口
 */
export interface NavigationOptions {
  /** 页面路径 */
  url: string;
  /** 路由参数 */
  params?: NavigationParams;
  /** 是否需要登录（可选，用于权限控制） */
  requireAuth?: boolean;
}

/**
 * 导航返回选项接口
 */
export interface NavigateBackOptions {
  /** 返回的页面数，默认 1 */
  delta?: number;
}

/**
 * 导航错误类
 *
 * 封装导航操作错误信息
 */
export class NavigationError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: any,
  ) {
    super(message);
    this.name = 'NavigationError';
  }
}

/**
 * 平台兼容的导航接口
 *
 * 提供统一的导航 API，屏蔽不同平台的差异
 *
 * **Validates: Requirements 3.5**
 */
export interface NavigationAdapter {
  /**
   * 保留当前页面，跳转到应用内的某个页面
   *
   * @param url 目标页面路径
   * @param params 路由参数（可选）
   * @returns Promise<void>
   * @throws {NavigationError} 当导航失败时抛出错误
   */
  navigateTo(url: string, params?: NavigationParams): Promise<void>;

  /**
   * 关闭当前页面，返回上一页面或多级页面
   *
   * @param delta 返回的页面数，默认 1
   * @returns Promise<void>
   * @throws {NavigationError} 当导航失败时抛出错误
   */
  navigateBack(delta?: number): Promise<void>;

  /**
   * 关闭当前页面，跳转到应用内的某个页面
   *
   * @param url 目标页面路径
   * @param params 路由参数（可选）
   * @returns Promise<void>
   * @throws {NavigationError} 当导航失败时抛出错误
   */
  redirectTo(url: string, params?: NavigationParams): Promise<void>;

  /**
   * 跳转到 tabBar 页面，并关闭其他所有非 tabBar 页面
   *
   * @param url 目标 tabBar 页面路径
   * @returns Promise<void>
   * @throws {NavigationError} 当导航失败时抛出错误
   */
  switchTab(url: string): Promise<void>;

  /**
   * 关闭所有页面，打开到应用内的某个页面
   *
   * @param url 目标页面路径
   * @param params 路由参数（可选）
   * @returns Promise<void>
   * @throws {NavigationError} 当导航失败时抛出错误
   */
  reLaunch(url: string, params?: NavigationParams): Promise<void>;

  /**
   * 返回首页；如果当前页面有上一级则返回，否则重启到首页
   *
   * @param url 首页路径，默认 /pages/index/index
   * @returns Promise<void>
   * @throws {NavigationError} 当导航失败时抛出错误
   */
  returnHome(url?: string): Promise<void>;
}

/**
 * 基于 Taro API 的导航适配器实现
 *
 * 使用 Taro.navigateTo/navigateBack/redirectTo 等 API 实现跨平台导航
 *
 * **特性：**
 * - 自动处理不同平台的导航 API 差异
 * - 统一的 Promise 接口
 * - 完善的错误处理
 * - 支持参数传递和类型安全
 * - 自动编码 URL 参数
 * - 结构化日志记录
 *
 * @example
 * ```typescript
 * const navigation = new TaroNavigationAdapter()
 *
 * // 跳转到详情页，传递参数
 * await navigation.navigateTo('/pages/detail/index', {
 *   id: 123,
 *   type: 'resume'
 * })
 *
 * // 返回上一页
 * await navigation.navigateBack()
 *
 * // 返回多级页面
 * await navigation.navigateBack(2)
 *
 * // 重定向到登录页
 * await navigation.redirectTo('/pages/login/index')
 *
 * // 切换到首页 tab
 * await navigation.switchTab('/pages/index/index')
 *
 * // 重启到首页
 * await navigation.reLaunch('/pages/index/index')
 * ```
 *
 * **Validates: Requirements 3.5**
 */
export class TaroNavigationAdapter implements NavigationAdapter {
  /**
   * 构建带参数的完整 URL
   *
   * 将路径和参数对象组合成完整的 URL 字符串
   *
   * @param url 基础路径
   * @param params 参数对象
   * @returns 完整的 URL 字符串
   *
   * @example
   * ```typescript
   * buildUrl('/pages/detail/index', { id: 123, name: '张三' })
   * // 返回: '/pages/detail/index?id=123&name=%E5%BC%A0%E4%B8%89'
   * ```
   */
  private buildUrl(url: string, params?: NavigationParams): string {
    if (!params || Object.keys(params).length === 0) {
      return url;
    }

    const queryString = Object.entries(params)
      .map(([key, value]) => {
        // 对参数值进行 URL 编码
        const encodedValue = encodeURIComponent(String(value));
        return `${key}=${encodedValue}`;
      })
      .join('&');

    // 检查 URL 是否已包含查询参数
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}${queryString}`;
  }

  /**
   * 处理导航错误
   *
   * 将 Taro 的错误信息转换为 NavigationError
   *
   * @param error 原始错误对象
   * @param action 导航操作名称
   * @param url 目标 URL
   * @returns NavigationError 实例
   */
  private handleError(
    error: any,
    action: string,
    url: string,
  ): NavigationError {
    console.error(`[Navigation] ${action} failed:`, {url, error});

    if (error && typeof error === 'object') {
      const errMsg = error.errMsg || error.message || '';

      // 页面不存在
      if (errMsg.includes('page not found') || errMsg.includes('不存在')) {
        return new NavigationError(`页面不存在: ${url}`, 'PAGE_NOT_FOUND', {
          url,
          originalError: error,
        });
      }

      // 页面栈超限
      if (errMsg.includes('limit exceeded') || errMsg.includes('超过')) {
        return new NavigationError(
          '页面层级太深，请使用 redirectTo 或 reLaunch',
          'PAGE_LIMIT_EXCEEDED',
          {url, originalError: error},
        );
      }

      // 其他错误
      return new NavigationError(
        errMsg || `${action} 失败`,
        'NAVIGATION_ERROR',
        {url, originalError: error},
      );
    }

    return new NavigationError(`${action} 失败: 未知错误`, 'UNKNOWN_ERROR', {
      url,
      originalError: error,
    });
  }

  /**
   * 保留当前页面，跳转到应用内的某个页面
   *
   * 使用 Taro.navigateTo 实现页面跳转，当前页面会保留在页面栈中
   *
   * **注意事项：**
   * - 不能跳转到 tabBar 页面（使用 switchTab 代替）
   * - 页面栈最多 10 层，超过后需要使用 redirectTo 或 reLaunch
   *
   * @param url 目标页面路径（必须以 / 开头）
   * @param params 路由参数（可选）
   * @throws {NavigationError} 当导航失败时抛出错误
   *
   * @example
   * ```typescript
   * // 跳转到详情页
   * await navigation.navigateTo('/pages/detail/index', {
   *   id: 123,
   *   type: 'resume'
   * })
   *
   * // 跳转到结果页
   * await navigation.navigateTo('/pages/result/index')
   * ```
   */
  async navigateTo(url: string, params?: NavigationParams): Promise<void> {
    try {
      const fullUrl = this.buildUrl(url, params);

      console.log('[Navigation] navigateTo:', {
        url,
        params,
        fullUrl,
      });

      await runWithNavigationTransition(
        () => Taro.navigateTo({url: fullUrl}),
        {kind: 'forward'},
      );

      console.log('[Navigation] navigateTo success:', {fullUrl});
    } catch (error) {
      throw this.handleError(error, 'navigateTo', url);
    }
  }

  /**
   * 关闭当前页面，返回上一页面或多级页面
   *
   * 使用 Taro.navigateBack 实现页面返回
   *
   * **注意事项：**
   * - delta 不能大于当前页面栈的深度
   * - 如果 delta 大于现有页面数，则返回到首页
   *
   * @param delta 返回的页面数，默认 1
   * @throws {NavigationError} 当导航失败时抛出错误
   *
   * @example
   * ```typescript
   * // 返回上一页
   * await navigation.navigateBack()
   *
   * // 返回两级页面
   * await navigation.navigateBack(2)
   * ```
   */
  async navigateBack(delta: number = 1): Promise<void> {
    try {
      console.log('[Navigation] navigateBack:', {delta});

      await runWithNavigationTransition(
        () => Taro.navigateBack({delta}),
        {kind: 'back'},
      );

      console.log('[Navigation] navigateBack success:', {delta});
    } catch (error) {
      throw this.handleError(error, 'navigateBack', `delta: ${delta}`);
    }
  }

  /**
   * 关闭当前页面，跳转到应用内的某个页面
   *
   * 使用 Taro.redirectTo 实现页面重定向，当前页面会从页面栈中移除
   *
   * **使用场景：**
   * - 登录后跳转到首页
   * - 页面栈层级过深时的跳转
   * - 不需要返回当前页面的场景
   *
   * **注意事项：**
   * - 不能跳转到 tabBar 页面（使用 switchTab 代替）
   *
   * @param url 目标页面路径（必须以 / 开头）
   * @param params 路由参数（可选）
   * @throws {NavigationError} 当导航失败时抛出错误
   *
   * @example
   * ```typescript
   * // 登录成功后重定向到首页
   * await navigation.redirectTo('/pages/index/index')
   *
   * // 重定向到错误页
   * await navigation.redirectTo('/pages/error/index', {
   *   code: 404,
   *   message: '页面不存在'
   * })
   * ```
   */
  async redirectTo(url: string, params?: NavigationParams): Promise<void> {
    try {
      const fullUrl = this.buildUrl(url, params);

      console.log('[Navigation] redirectTo:', {
        url,
        params,
        fullUrl,
      });

      await runWithNavigationTransition(
        () => Taro.redirectTo({url: fullUrl}),
        {kind: 'replace'},
      );

      console.log('[Navigation] redirectTo success:', {fullUrl});
    } catch (error) {
      throw this.handleError(error, 'redirectTo', url);
    }
  }

  /**
   * 跳转到 tabBar 页面，并关闭其他所有非 tabBar 页面
   *
   * 使用 Taro.switchTab 实现 tabBar 页面切换
   *
   * **注意事项：**
   * - 只能跳转到 app.config.ts 中 tabBar 配置的页面
   * - 不支持传递参数（tabBar 页面不接收参数）
   * - 会关闭所有非 tabBar 页面
   *
   * @param url 目标 tabBar 页面路径（必须以 / 开头）
   * @throws {NavigationError} 当导航失败时抛出错误
   *
   * @example
   * ```typescript
   * // 切换到首页 tab
   * await navigation.switchTab('/pages/index/index')
   *
   * // 切换到设置 tab
   * await navigation.switchTab('/pages/settings/index')
   * ```
   */
  async switchTab(url: string): Promise<void> {
    try {
      console.log('[Navigation] switchTab:', {url});

      await runWithNavigationTransition(
        () => Taro.switchTab({url}),
        {kind: 'replace'},
      );

      console.log('[Navigation] switchTab success:', {url});
    } catch (error) {
      throw this.handleError(error, 'switchTab', url);
    }
  }

  /**
   * 关闭所有页面，打开到应用内的某个页面
   *
   * 使用 Taro.reLaunch 实现应用重启式跳转，会清空整个页面栈
   *
   * **使用场景：**
   * - 退出登录后返回登录页
   * - 应用重置到初始状态
   * - 需要清空所有页面历史的场景
   *
   * **注意事项：**
   * - 可以跳转到任意页面（包括 tabBar 页面）
   * - 会清空整个页面栈，用户无法返回之前的页面
   *
   * @param url 目标页面路径（必须以 / 开头）
   * @param params 路由参数（可选）
   * @throws {NavigationError} 当导航失败时抛出错误
   *
   * @example
   * ```typescript
   * // 退出登录，重启到登录页
   * await navigation.reLaunch('/pages/login/index')
   *
   * // 重启到首页
   * await navigation.reLaunch('/pages/index/index', {
   *   from: 'logout'
   * })
   * ```
   */
  async reLaunch(url: string, params?: NavigationParams): Promise<void> {
    try {
      const fullUrl = this.buildUrl(url, params);

      console.log('[Navigation] reLaunch:', {
        url,
        params,
        fullUrl,
      });

      await runWithNavigationTransition(
        () => Taro.reLaunch({url: fullUrl}),
        {kind: 'root'},
      );

      console.log('[Navigation] reLaunch success:', {fullUrl});
    } catch (error) {
      throw this.handleError(error, 'reLaunch', url);
    }
  }

  /**
   * 返回首页
   *
   * H5 直接访问 hash 路由时页面栈可能只有当前页，Taro.navigateBack
   * 可能不会抛错但也不会发生有效跳转，因此这里先显式检查页面栈。
   *
   * @param url 首页路径，默认 /pages/index/index
   */
  async returnHome(url: string = '/pages/index/index'): Promise<void> {
    if (this.canGoBack()) {
      await this.navigateBack();
      return;
    }

    await this.reLaunch(url);
  }

  /**
   * 获取当前页面栈
   *
   * 返回当前页面栈的所有页面实例
   *
   * @returns 页面栈数组
   *
   * @example
   * ```typescript
   * const pages = navigation.getCurrentPages()
   * console.log('当前页面栈深度:', pages.length)
   * console.log('当前页面路由:', pages[pages.length - 1].route)
   * ```
   */
  getCurrentPages(): any[] {
    return Taro.getCurrentPages();
  }

  /**
   * 获取当前页面路由
   *
   * @returns 当前页面的路由路径
   *
   * @example
   * ```typescript
   * const route = navigation.getCurrentRoute()
   * console.log('当前路由:', route) // 例如: 'pages/index/index'
   * ```
   */
  getCurrentRoute(): string {
    const pages = this.getCurrentPages();
    if (pages.length === 0) {
      return '';
    }
    const currentPage = pages[pages.length - 1];
    return currentPage.route || '';
  }

  /**
   * 检查是否可以返回
   *
   * 判断当前页面栈是否有上一页可以返回
   *
   * @returns 是否可以返回
   *
   * @example
   * ```typescript
   * if (navigation.canGoBack()) {
   *   await navigation.navigateBack()
   * } else {
   *   await navigation.reLaunch('/pages/index/index')
   * }
   * ```
   */
  canGoBack(): boolean {
    const pages = this.getCurrentPages();
    return pages.length > 1;
  }
}

/**
 * 默认导航适配器实例
 *
 * 提供一个全局单例，方便在应用中直接使用
 *
 * @example
 * ```typescript
 * import { navigation } from '@/utils/navigation'
 *
 * // 直接使用
 * await navigation.navigateTo('/pages/detail/index', { id: 123 })
 * await navigation.navigateBack()
 * ```
 */
export const navigation: NavigationAdapter = new TaroNavigationAdapter();

/**
 * 导航工具函数：解析 URL 参数
 *
 * 从 URL 查询字符串中解析参数对象
 *
 * @param url 完整的 URL 字符串
 * @returns 参数对象
 *
 * @example
 * ```typescript
 * const params = parseUrlParams('/pages/detail/index?id=123&type=resume')
 * console.log(params) // { id: '123', type: 'resume' }
 * ```
 */
export function parseUrlParams(url: string): Record<string, string> {
  const params: Record<string, string> = {};

  const queryIndex = url.indexOf('?');
  if (queryIndex === -1) {
    return params;
  }

  const queryString = url.slice(queryIndex + 1);
  const pairs = queryString.split('&');

  for (const pair of pairs) {
    const [key, value] = pair.split('=');
    if (key) {
      params[key] = value ? decodeURIComponent(value) : '';
    }
  }

  return params;
}

/**
 * 导航工具函数：获取当前页面参数
 *
 * 获取当前页面的路由参数
 *
 * @returns 当前页面的参数对象
 *
 * @example
 * ```typescript
 * // 在 /pages/detail/index?id=123&type=resume 页面中
 * const params = getCurrentPageParams()
 * console.log(params) // { id: '123', type: 'resume' }
 * ```
 */
export function getCurrentPageParams(): Record<string, string> {
  const pages = Taro.getCurrentPages();
  if (pages.length === 0) {
    return {};
  }

  const currentPage = pages[pages.length - 1] as any;
  return currentPage.options || {};
}

/**
 * 导航工具函数：类型安全的参数获取
 *
 * 从参数对象中获取指定类型的参数值
 *
 * @param params 参数对象
 * @param key 参数键名
 * @param defaultValue 默认值
 * @returns 参数值
 *
 * @example
 * ```typescript
 * const params = getCurrentPageParams()
 *
 * // 获取字符串参数
 * const type = getParam(params, 'type', 'default')
 *
 * // 获取数字参数
 * const id = getParamAsNumber(params, 'id', 0)
 *
 * // 获取布尔参数
 * const isEdit = getParamAsBoolean(params, 'edit', false)
 * ```
 */
export function getParam(
  params: Record<string, string>,
  key: string,
  defaultValue: string = '',
): string {
  return params[key] || defaultValue;
}

/**
 * 获取数字类型参数
 */
export function getParamAsNumber(
  params: Record<string, string>,
  key: string,
  defaultValue: number = 0,
): number {
  const value = params[key];
  if (!value) {
    return defaultValue;
  }

  const num = Number(value);
  return isNaN(num) ? defaultValue : num;
}

/**
 * 获取布尔类型参数
 */
export function getParamAsBoolean(
  params: Record<string, string>,
  key: string,
  defaultValue: boolean = false,
): boolean {
  const value = params[key];
  if (!value) {
    return defaultValue;
  }

  return value === 'true' || value === '1';
}
