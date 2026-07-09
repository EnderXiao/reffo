import {describe, test, expect, beforeEach, jest} from '@jest/globals';
import Taro from '@tarojs/taro';
import {
  PlatformType,
  getPlatform,
  isIOS,
  isAndroid,
  isWeapp,
  isH5,
  isNative,
  getPlatformName,
} from '../platform';

// Mock Taro
jest.mock('@tarojs/taro', () => ({
  getEnv: jest.fn(),
  getSystemInfoSync: jest.fn(),
  ENV_TYPE: {
    WEAPP: 'WEAPP',
    WEB: 'WEB',
    RN: 'RN',
  },
}));

describe('Platform Utils', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getPlatform', () => {
    test('should detect WeChat Mini Program platform', () => {
      (Taro.getEnv as jest.Mock).mockReturnValue(Taro.ENV_TYPE.WEAPP);

      const platform = getPlatform();

      expect(platform).toBe(PlatformType.WEAPP);
    });

    test('should detect H5 platform', () => {
      (Taro.getEnv as jest.Mock).mockReturnValue(Taro.ENV_TYPE.WEB);

      const platform = getPlatform();

      expect(platform).toBe(PlatformType.H5);
    });

    test('should detect iOS platform in React Native', () => {
      (Taro.getEnv as jest.Mock).mockReturnValue(Taro.ENV_TYPE.RN);
      (Taro.getSystemInfoSync as jest.Mock).mockReturnValue({
        platform: 'ios',
      });

      const platform = getPlatform();

      expect(platform).toBe(PlatformType.IOS);
    });

    test('should detect Android platform in React Native', () => {
      (Taro.getEnv as jest.Mock).mockReturnValue(Taro.ENV_TYPE.RN);
      (Taro.getSystemInfoSync as jest.Mock).mockReturnValue({
        platform: 'android',
      });

      const platform = getPlatform();

      expect(platform).toBe(PlatformType.ANDROID);
    });

    test('should default to iOS when RN platform is unknown', () => {
      (Taro.getEnv as jest.Mock).mockReturnValue(Taro.ENV_TYPE.RN);
      (Taro.getSystemInfoSync as jest.Mock).mockReturnValue({
        platform: 'unknown',
      });

      const platform = getPlatform();

      expect(platform).toBe(PlatformType.IOS);
    });

    test('should handle getSystemInfoSync error and default to iOS', () => {
      (Taro.getEnv as jest.Mock).mockReturnValue(Taro.ENV_TYPE.RN);
      (Taro.getSystemInfoSync as jest.Mock).mockImplementation(() => {
        throw new Error('System info not available');
      });

      const platform = getPlatform();

      expect(platform).toBe(PlatformType.IOS);
    });

    test('should default to H5 for unknown environment', () => {
      (Taro.getEnv as jest.Mock).mockReturnValue('UNKNOWN');

      const platform = getPlatform();

      expect(platform).toBe(PlatformType.H5);
    });
  });

  describe('Platform check functions', () => {
    test('isIOS should return true for iOS platform', () => {
      (Taro.getEnv as jest.Mock).mockReturnValue(Taro.ENV_TYPE.RN);
      (Taro.getSystemInfoSync as jest.Mock).mockReturnValue({
        platform: 'ios',
      });

      expect(isIOS()).toBe(true);
      expect(isAndroid()).toBe(false);
      expect(isWeapp()).toBe(false);
      expect(isH5()).toBe(false);
    });

    test('isAndroid should return true for Android platform', () => {
      (Taro.getEnv as jest.Mock).mockReturnValue(Taro.ENV_TYPE.RN);
      (Taro.getSystemInfoSync as jest.Mock).mockReturnValue({
        platform: 'android',
      });

      expect(isAndroid()).toBe(true);
      expect(isIOS()).toBe(false);
      expect(isWeapp()).toBe(false);
      expect(isH5()).toBe(false);
    });

    test('isWeapp should return true for WeChat Mini Program', () => {
      (Taro.getEnv as jest.Mock).mockReturnValue(Taro.ENV_TYPE.WEAPP);

      expect(isWeapp()).toBe(true);
      expect(isIOS()).toBe(false);
      expect(isAndroid()).toBe(false);
      expect(isH5()).toBe(false);
    });

    test('isH5 should return true for H5 platform', () => {
      (Taro.getEnv as jest.Mock).mockReturnValue(Taro.ENV_TYPE.WEB);

      expect(isH5()).toBe(true);
      expect(isIOS()).toBe(false);
      expect(isAndroid()).toBe(false);
      expect(isWeapp()).toBe(false);
    });
  });

  describe('isNative', () => {
    test('should return true for iOS', () => {
      (Taro.getEnv as jest.Mock).mockReturnValue(Taro.ENV_TYPE.RN);
      (Taro.getSystemInfoSync as jest.Mock).mockReturnValue({
        platform: 'ios',
      });

      expect(isNative()).toBe(true);
    });

    test('should return true for Android', () => {
      (Taro.getEnv as jest.Mock).mockReturnValue(Taro.ENV_TYPE.RN);
      (Taro.getSystemInfoSync as jest.Mock).mockReturnValue({
        platform: 'android',
      });

      expect(isNative()).toBe(true);
    });

    test('should return false for WeChat Mini Program', () => {
      (Taro.getEnv as jest.Mock).mockReturnValue(Taro.ENV_TYPE.WEAPP);

      expect(isNative()).toBe(false);
    });

    test('should return false for H5', () => {
      (Taro.getEnv as jest.Mock).mockReturnValue(Taro.ENV_TYPE.WEB);

      expect(isNative()).toBe(false);
    });
  });

  describe('getPlatformName', () => {
    test('should return correct display names', () => {
      (Taro.getEnv as jest.Mock).mockReturnValue(Taro.ENV_TYPE.RN);
      (Taro.getSystemInfoSync as jest.Mock).mockReturnValue({
        platform: 'ios',
      });
      expect(getPlatformName()).toBe('iOS');
      (Taro.getSystemInfoSync as jest.Mock).mockReturnValue({
        platform: 'android',
      });
      expect(getPlatformName()).toBe('Android');
      (Taro.getEnv as jest.Mock).mockReturnValue(Taro.ENV_TYPE.WEAPP);
      expect(getPlatformName()).toBe('微信小程序');
      (Taro.getEnv as jest.Mock).mockReturnValue(Taro.ENV_TYPE.WEB);
      expect(getPlatformName()).toBe('H5');
    });
  });

  describe('Platform consistency (Property 1)', () => {
    test('should return consistent platform type across multiple calls', () => {
      (Taro.getEnv as jest.Mock).mockReturnValue(Taro.ENV_TYPE.WEAPP);

      const platform1 = getPlatform();
      const platform2 = getPlatform();
      const platform3 = getPlatform();

      expect(platform1).toBe(platform2);
      expect(platform2).toBe(platform3);
      expect(platform1).toBe(PlatformType.WEAPP);
    });

    test('should provide consistent boolean checks for same platform', () => {
      (Taro.getEnv as jest.Mock).mockReturnValue(Taro.ENV_TYPE.RN);
      (Taro.getSystemInfoSync as jest.Mock).mockReturnValue({
        platform: 'ios',
      });

      // 多次调用应该返回一致的结果
      expect(isIOS()).toBe(true);
      expect(isIOS()).toBe(true);
      expect(isIOS()).toBe(true);

      expect(isNative()).toBe(true);
      expect(isNative()).toBe(true);
    });
  });
});
