/**
 * 导航适配器使用示例
 *
 * 本文件展示了如何在 Taro 应用中使用导航适配器
 */

import {navigation, getCurrentPageParams, getParamAsNumber} from './navigation';

/**
 * 示例 1: 基本页面跳转
 */
export async function example1_BasicNavigation() {
  // 跳转到详情页
  await navigation.navigateTo('/pages/detail/index');

  // 跳转到详情页并传递参数
  await navigation.navigateTo('/pages/detail/index', {
    id: 123,
    type: 'resume',
  });

  // 返回上一页
  await navigation.navigateBack();

  // 返回多级页面
  await navigation.navigateBack(2);
}

/**
 * 示例 2: 页面重定向
 */
export async function example2_Redirect() {
  // 登录成功后重定向到首页
  await navigation.redirectTo('/pages/index/index');

  // 重定向到错误页并传递错误信息
  await navigation.redirectTo('/pages/error/index', {
    code: 404,
    message: '页面不存在',
  });
}

/**
 * 示例 3: TabBar 页面切换
 */
export async function example3_TabBar() {
  // 切换到首页 tab
  await navigation.switchTab('/pages/index/index');

  // 切换到设置 tab
  await navigation.switchTab('/pages/settings/index');
}

/**
 * 示例 4: 应用重启
 */
export async function example4_ReLaunch() {
  // 退出登录，重启到登录页
  await navigation.reLaunch('/pages/login/index');

  // 重启到首页并传递参数
  await navigation.reLaunch('/pages/index/index', {
    from: 'logout',
  });
}

/**
 * 示例 5: 错误处理
 */
export async function example5_ErrorHandling() {
  try {
    await navigation.navigateTo('/pages/nonexistent/index');
  } catch (error) {
    if (error instanceof Error) {
      console.error('导航失败:', error.message);
      // 显示错误提示
      // Taro.showToast({ title: error.message, icon: 'none' })
    }
  }
}

/**
 * 示例 6: 页面栈管理
 */
export function example6_PageStack() {
  // 获取当前页面栈
  const pages = navigation.getCurrentPages();
  console.log('页面栈深度:', pages.length);

  // 获取当前路由
  const route = navigation.getCurrentRoute();
  console.log('当前路由:', route);

  // 检查是否可以返回
  if (navigation.canGoBack()) {
    navigation.navigateBack();
  } else {
    // 如果不能返回，跳转到首页
    navigation.reLaunch('/pages/index/index');
  }
}

/**
 * 示例 7: 在页面中接收参数
 */
export function example7_ReceiveParams() {
  // 获取当前页面的所有参数
  const params = getCurrentPageParams();
  console.log('页面参数:', params);

  // 获取特定参数
  const id = getParamAsNumber(params, 'id', 0);
  const type = params.type || 'default';

  console.log('ID:', id);
  console.log('类型:', type);
}

/**
 * 示例 8: 在 React 组件中使用
 */
export function Example8_InComponent() {
  // 在组件中使用导航
  const handleNavigate = async () => {
    try {
      await navigation.navigateTo('/pages/detail/index', {
        id: 123,
      });
    } catch (error) {
      console.error('导航失败:', error);
    }
  };

  const handleBack = async () => {
    if (navigation.canGoBack()) {
      await navigation.navigateBack();
    } else {
      await navigation.switchTab('/pages/index/index');
    }
  };

  return {
    handleNavigate,
    handleBack,
  };
}

/**
 * 示例 9: 条件导航
 */
export async function example9_ConditionalNavigation(isLoggedIn: boolean) {
  if (isLoggedIn) {
    // 已登录，跳转到首页
    await navigation.switchTab('/pages/index/index');
  } else {
    // 未登录，重定向到登录页
    await navigation.redirectTo('/pages/login/index', {
      redirect: '/pages/index/index',
    });
  }
}

/**
 * 示例 10: 复杂参数传递
 */
export async function example10_ComplexParams() {
  // 传递多种类型的参数
  await navigation.navigateTo('/pages/result/index', {
    resumeId: 123,
    jdId: 456,
    score: 85.5,
    isOptimized: true,
    timestamp: Date.now(),
  });

  // 在目标页面接收参数
  const params = getCurrentPageParams();
  const resumeId = getParamAsNumber(params, 'resumeId', 0);
  const score = getParamAsNumber(params, 'score', 0);
  // 注意：所有参数都会被转换为字符串，需要手动转换类型
}

/**
 * 示例 11: 中文参数处理
 */
export async function example11_ChineseParams() {
  // 传递中文参数（会自动进行 URL 编码）
  await navigation.navigateTo('/pages/search/index', {
    keyword: '前端工程师',
    location: '北京',
  });

  // 在目标页面接收参数（会自动解码）
  const params = getCurrentPageParams();
  console.log('搜索关键词:', params.keyword); // '前端工程师'
  console.log('地点:', params.location); // '北京'
}

/**
 * 示例 12: 导航守卫模式
 */
export async function example12_NavigationGuard(
  targetUrl: string,
  requireAuth: boolean = false,
) {
  // 检查是否需要登录
  if (requireAuth) {
    const isLoggedIn = checkLoginStatus(); // 假设有这个函数

    if (!isLoggedIn) {
      // 未登录，跳转到登录页，并记录目标页面
      await navigation.redirectTo('/pages/login/index', {
        redirect: targetUrl,
      });
      return;
    }
  }

  // 已登录或不需要登录，正常跳转
  await navigation.navigateTo(targetUrl);
}

// 辅助函数
function checkLoginStatus(): boolean {
  // 实际项目中应该从 store 或 storage 中获取登录状态
  return false;
}
