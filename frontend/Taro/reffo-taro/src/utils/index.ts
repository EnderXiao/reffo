/**
 * Utils 模块统一导出
 *
 * 提供平台兼容层、验证工具、辅助函数等工具模块
 */

// 平台检测工具
export {
  PlatformType,
  getPlatform,
  isIOS,
  isAndroid,
  isWeapp,
  isH5,
  isNative,
  getPlatformName,
} from './platform';

// 错误处理工具
export {
  AppError,
  ErrorType,
  getErrorMessage,
  handleError,
  showErrorToast,
  showErrorModal,
  createNetworkError,
  createTimeoutError,
  createApiError,
  createValidationError,
  createBusinessError,
  isNetworkError,
  isApiError,
  isValidationError,
} from './error';

// 重试工具
export {
  retry,
  withRetry,
  Retry,
  retryAll,
  retryUntil,
  RetryPresets,
  type RetryOptions,
  type BackoffStrategy,
} from './retry';


// 布局与安全区工具
export {
  DEFAULT_PAGE_MAX_WIDTH,
  DEFAULT_NAV_BAR_HEIGHT,
  DEFAULT_FLOATING_TOP_OFFSET,
  DEFAULT_FLOATING_TOP_SPACING,
  DEFAULT_PAGE_BOTTOM_PADDING,
  getDeviceSystemInfo,
  getStatusBarHeight,
  getBottomInset,
  getTopNavigationHeight,
  getFloatingTopInset,
  getPageContentWidth,
  getPageSideInset,
  getPageBottomPadding,
  resolveStatusBarHeight,
  resolveBottomInset,
  useDeviceLayoutMetrics,
  type DeviceSafeArea,
  type DeviceSystemInfo,
  type DeviceLayoutMetrics,
} from './layout';

// 视觉能力分层工具
export {
  detectVisualTierSync,
  logVisualTier,
  measureFrameBudget,
  resolveVisualTier,
  useVisualTier,
  type VisualCapabilitySnapshot,
  type VisualTier,
} from './visual-tier';
