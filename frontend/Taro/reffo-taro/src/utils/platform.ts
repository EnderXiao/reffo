import Taro from '@tarojs/taro';

/**
 * 平台类型枚举
 *
 * 定义应用支持的所有平台类型
 */
export enum PlatformType {
  /** iOS 平台 */
  IOS = 'ios',
  /** Android 平台 */
  ANDROID = 'android',
  /** 微信小程序 */
  WEAPP = 'weapp',
  /** H5 浏览器 */
  H5 = 'h5',
}

/**
 * 获取当前运行平台
 *
 * 使用 Taro.getEnv() 检测当前应用运行的平台环境
 *
 * @returns {PlatformType} 当前平台类型
 *
 * @example
 * ```typescript
 * const platform = getPlatform()
 * if (platform === PlatformType.IOS) {
 *   // iOS 特定逻辑
 * }
 * ```
 *
 * **Validates: Requirements 3.1, 3.6**
 */
export function getPlatform(): PlatformType {
  const env = Taro.getEnv();

  switch (env) {
    case Taro.ENV_TYPE.WEAPP:
      return PlatformType.WEAPP;
    case Taro.ENV_TYPE.WEB:
      return PlatformType.H5;
    case Taro.ENV_TYPE.RN:
      // 在 React Native 环境中，需要进一步判断是 iOS 还是 Android
      // 使用 Taro.getSystemInfoSync() 获取系统信息
      try {
        const systemInfo = Taro.getSystemInfoSync();
        const platform = systemInfo.platform?.toLowerCase() || '';

        if (platform.includes('ios')) {
          return PlatformType.IOS;
        } else if (platform.includes('android')) {
          return PlatformType.ANDROID;
        }

        // 默认返回 iOS（因为项目首先支持 iOS）
        return PlatformType.IOS;
      } catch (error) {
        console.warn(
          '[Platform] Failed to detect RN platform, defaulting to iOS:',
          error,
        );
        return PlatformType.IOS;
      }
    default:
      // 未知环境，默认返回 H5
      console.warn('[Platform] Unknown environment, defaulting to H5:', env);
      return PlatformType.H5;
  }
}

/**
 * 检查是否为 iOS 平台
 *
 * @returns {boolean} 是否为 iOS 平台
 */
export function isIOS(): boolean {
  return getPlatform() === PlatformType.IOS;
}

/**
 * 检查是否为 Android 平台
 *
 * @returns {boolean} 是否为 Android 平台
 */
export function isAndroid(): boolean {
  return getPlatform() === PlatformType.ANDROID;
}

/**
 * 检查是否为微信小程序平台
 *
 * @returns {boolean} 是否为微信小程序平台
 */
export function isWeapp(): boolean {
  return getPlatform() === PlatformType.WEAPP;
}

/**
 * 检查是否为 H5 平台
 *
 * @returns {boolean} 是否为 H5 平台
 */
export function isH5(): boolean {
  return getPlatform() === PlatformType.H5;
}

/**
 * 检查是否为原生平台（iOS 或 Android）
 *
 * @returns {boolean} 是否为原生平台
 */
export function isNative(): boolean {
  const platform = getPlatform();
  return platform === PlatformType.IOS || platform === PlatformType.ANDROID;
}

/**
 * 获取平台显示名称
 *
 * @returns {string} 平台的友好显示名称
 */
export function getPlatformName(): string {
  const platform = getPlatform();

  switch (platform) {
    case PlatformType.IOS:
      return 'iOS';
    case PlatformType.ANDROID:
      return 'Android';
    case PlatformType.WEAPP:
      return '微信小程序';
    case PlatformType.H5:
      return 'H5';
    default:
      return '未知平台';
  }
}
