/**
 * Store 配置
 *
 * 定义 Zustand store 的通用配置，包括持久化选项等
 */

import {StateStorage} from 'zustand/middleware';
import {storage} from '@/utils/storage';

/**
 * 自定义存储适配器
 * 将 Zustand 的持久化中间件适配到 Taro 的存储 API
 */
export const taroStorage: StateStorage = {
  getItem: async (name: string): Promise<string | null> => {
    try {
      const value = await storage.getItem(name);
      return value || null;
    } catch (error) {
      console.error(`[Store] Failed to get item ${name}:`, error);
      return null;
    }
  },

  setItem: async (name: string, value: string): Promise<void> => {
    try {
      await storage.setItem(name, value);
    } catch (error) {
      console.error(`[Store] Failed to set item ${name}:`, error);
    }
  },

  removeItem: async (name: string): Promise<void> => {
    try {
      await storage.removeItem(name);
    } catch (error) {
      console.error(`[Store] Failed to remove item ${name}:`, error);
    }
  },
};

/**
 * Store 持久化配置
 */
export const persistConfig = {
  // 使用自定义的 Taro 存储适配器
  storage: taroStorage,

  // 持久化版本号（用于迁移）
  version: 1,

  // 序列化和反序列化选项
  serialize: JSON.stringify,
  deserialize: JSON.parse,
};

/**
 * Store 名称常量
 */
export const STORE_KEYS = {
  RESUME: 'reffo-resume-store',
  JD: 'reffo-jd-store',
  OPTIMIZED: 'reffo-optimized-store',
  HISTORY: 'reffo-history-store',
} as const;
