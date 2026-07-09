/**
 * Store 配置测试
 */

import {describe, test, expect, beforeEach} from '@jest/globals';
import {taroStorage, persistConfig, STORE_KEYS} from '../config';
import {storage} from '@/utils/storage';

describe('Store Config', () => {
  beforeEach(async () => {
    // 清理测试数据
    await storage.clear();
  });

  describe('taroStorage', () => {
    test('应该能够存储和读取数据', async () => {
      const key = 'test-key';
      const value = JSON.stringify({data: 'test-value'});

      await taroStorage.setItem(key, value);
      const result = await taroStorage.getItem(key);

      expect(result).toBe(value);
    });

    test('应该能够删除数据', async () => {
      const key = 'test-key';
      const value = JSON.stringify({data: 'test-value'});

      await taroStorage.setItem(key, value);
      await taroStorage.removeItem(key);
      const result = await taroStorage.getItem(key);

      expect(result).toBeNull();
    });

    test('读取不存在的键应该返回 null', async () => {
      const result = await taroStorage.getItem('non-existent-key');
      expect(result).toBeNull();
    });

    test('应该处理存储错误', async () => {
      // 测试错误处理（不应该抛出异常）
      const result = await taroStorage.getItem('');
      expect(result).toBeNull();
    });
  });

  describe('persistConfig', () => {
    test('应该包含正确的配置', () => {
      expect(persistConfig).toHaveProperty('storage');
      expect(persistConfig).toHaveProperty('version');
      expect(persistConfig).toHaveProperty('serialize');
      expect(persistConfig).toHaveProperty('deserialize');
    });

    test('版本号应该是数字', () => {
      expect(typeof persistConfig.version).toBe('number');
      expect(persistConfig.version).toBeGreaterThan(0);
    });

    test('序列化和反序列化应该正常工作', () => {
      const data = {test: 'value', number: 123};
      const serialized = persistConfig.serialize(data);
      const deserialized = persistConfig.deserialize(serialized);

      expect(deserialized).toEqual(data);
    });
  });

  describe('STORE_KEYS', () => {
    test('应该定义所有必需的 store 键', () => {
      expect(STORE_KEYS).toHaveProperty('RESUME');
      expect(STORE_KEYS).toHaveProperty('JD');
      expect(STORE_KEYS).toHaveProperty('OPTIMIZED');
      expect(STORE_KEYS).toHaveProperty('HISTORY');
    });

    test('所有键应该有 reffo 前缀', () => {
      Object.values(STORE_KEYS).forEach(key => {
        expect(key).toMatch(/^reffo-/);
      });
    });

    test('所有键应该有 store 后缀', () => {
      Object.values(STORE_KEYS).forEach(key => {
        expect(key).toMatch(/-store$/);
      });
    });

    test('所有键应该是唯一的', () => {
      const keys = Object.values(STORE_KEYS);
      const uniqueKeys = new Set(keys);
      expect(uniqueKeys.size).toBe(keys.length);
    });
  });
});
