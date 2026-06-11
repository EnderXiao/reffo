import Taro from '@tarojs/taro';
import {Platform, StatusBar, useWindowDimensions} from 'react-native';

export const DEFAULT_PAGE_MAX_WIDTH = 393;
export const DEFAULT_NAV_BAR_HEIGHT = 54;
export const DEFAULT_FLOATING_TOP_OFFSET = 19;
export const DEFAULT_FLOATING_TOP_SPACING = 10;
export const DEFAULT_PAGE_BOTTOM_PADDING = 30;

export interface DeviceSafeArea {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
  width?: number;
  height?: number;
}

export interface DeviceSystemInfo {
  screenWidth?: number;
  screenHeight?: number;
  windowWidth?: number;
  windowHeight?: number;
  statusBarHeight?: number;
  safeArea?: DeviceSafeArea;
}

export interface DeviceLayoutMetrics {
  viewportWidth: number;
  viewportHeight: number;
  screenWidth: number;
  screenHeight: number;
  contentWidth: number;
  sideInset: number;
  statusBarHeight: number;
  bottomInset: number;
  navigationHeight: number;
  floatingTopInset: number;
  pageBottomPadding: number;
}

export function resolveStatusBarHeight(height?: number): number {
  if (typeof height !== 'number' || Number.isNaN(height)) {
    return 0;
  }

  return Math.max(0, height);
}

export function resolveBottomInset(
  screenHeight?: number,
  safeAreaBottom?: number,
  windowHeight?: number,
): number {
  if (typeof screenHeight !== 'number' || Number.isNaN(screenHeight)) {
    return 0;
  }

  if (typeof safeAreaBottom === 'number' && !Number.isNaN(safeAreaBottom)) {
    return Math.max(0, screenHeight - safeAreaBottom);
  }

  if (typeof windowHeight === 'number' && !Number.isNaN(windowHeight)) {
    return Math.max(0, screenHeight - windowHeight);
  }

  return 0;
}

export function getDeviceSystemInfo(): DeviceSystemInfo {
  try {
    return (Taro.getSystemInfoSync?.() ?? {}) as DeviceSystemInfo;
  } catch (_error) {
    return {};
  }
}

export function getStatusBarHeight(systemInfo: DeviceSystemInfo = getDeviceSystemInfo()): number {
  if (typeof systemInfo.statusBarHeight === 'number') {
    return resolveStatusBarHeight(systemInfo.statusBarHeight);
  }

  if (Platform.OS === 'android') {
    return resolveStatusBarHeight(StatusBar.currentHeight);
  }

  return 0;
}

export function getBottomInset(systemInfo: DeviceSystemInfo = getDeviceSystemInfo()): number {
  return resolveBottomInset(
    systemInfo.screenHeight,
    systemInfo.safeArea?.bottom,
    systemInfo.windowHeight,
  );
}

export function getTopNavigationHeight(
  statusBarHeight = getStatusBarHeight(),
  navBarHeight = DEFAULT_NAV_BAR_HEIGHT,
): number {
  return resolveStatusBarHeight(statusBarHeight) + Math.max(0, navBarHeight);
}

export function getFloatingTopInset(
  baseOffset = DEFAULT_FLOATING_TOP_OFFSET,
  statusBarHeight = getStatusBarHeight(),
  extraSpacing = DEFAULT_FLOATING_TOP_SPACING,
): number {
  return Math.max(
    baseOffset,
    resolveStatusBarHeight(statusBarHeight) + Math.max(0, extraSpacing),
  );
}

export function getPageContentWidth(
  viewportWidth: number,
  maxWidth = DEFAULT_PAGE_MAX_WIDTH,
): number {
  return Math.min(Math.max(0, viewportWidth), maxWidth);
}

export function getPageSideInset(
  viewportWidth: number,
  maxWidth = DEFAULT_PAGE_MAX_WIDTH,
): number {
  return Math.max(
    0,
    (viewportWidth - getPageContentWidth(viewportWidth, maxWidth)) / 2,
  );
}

export function getPageBottomPadding(
  basePadding = DEFAULT_PAGE_BOTTOM_PADDING,
  bottomInset = 0,
): number {
  return Math.max(0, basePadding) + Math.max(0, bottomInset);
}

export function useDeviceLayoutMetrics(): DeviceLayoutMetrics {
  const {width, height} = useWindowDimensions();
  const systemInfo = getDeviceSystemInfo();
  const statusBarHeight = getStatusBarHeight(systemInfo);
  const bottomInset = getBottomInset(systemInfo);
  const contentWidth = getPageContentWidth(width);

  return {
    viewportWidth: width,
    viewportHeight: height,
    screenWidth: systemInfo.screenWidth ?? width,
    screenHeight: systemInfo.screenHeight ?? height,
    contentWidth,
    sideInset: getPageSideInset(width),
    statusBarHeight,
    bottomInset,
    navigationHeight: getTopNavigationHeight(statusBarHeight),
    floatingTopInset: getFloatingTopInset(
      DEFAULT_FLOATING_TOP_OFFSET,
      statusBarHeight,
    ),
    pageBottomPadding: getPageBottomPadding(
      DEFAULT_PAGE_BOTTOM_PADDING,
      bottomInset,
    ),
  };
}
