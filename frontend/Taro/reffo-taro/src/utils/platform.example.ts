/**
 * 平台检测工具使用示例
 *
 * 本文件展示如何在应用中使用平台检测工具
 */

import {
  getPlatform,
  PlatformType,
  isIOS,
  isAndroid,
  isWeapp,
  isH5,
  isNative,
  getPlatformName,
} from './platform';

/**
 * 示例 1: 基础平台检测
 */
export function basicPlatformDetection() {
  const platform = getPlatform();
  console.log('当前平台:', platform);
  console.log('平台名称:', getPlatformName());
}

/**
 * 示例 2: 条件渲染
 */
export function conditionalRendering() {
  if (isIOS()) {
    // iOS 特定逻辑
    console.log('运行在 iOS 平台');
  } else if (isAndroid()) {
    // Android 特定逻辑
    console.log('运行在 Android 平台');
  } else if (isWeapp()) {
    // 微信小程序特定逻辑
    console.log('运行在微信小程序');
  } else if (isH5()) {
    // H5 特定逻辑
    console.log('运行在 H5 浏览器');
  }
}

/**
 * 示例 3: 平台特定样式
 */
export function getPlatformSpecificStyle() {
  const platform = getPlatform();

  switch (platform) {
    case PlatformType.IOS:
      return {paddingTop: 44}; // iOS 状态栏高度
    case PlatformType.ANDROID:
      return {paddingTop: 24}; // Android 状态栏高度
    default:
      return {paddingTop: 0};
  }
}

/**
 * 示例 4: 原生平台检测
 */
export function nativePlatformFeature() {
  if (isNative()) {
    // 原生平台特有功能
    console.log('可以使用原生 API');
  } else {
    // Web 平台降级方案
    console.log('使用 Web API');
  }
}
