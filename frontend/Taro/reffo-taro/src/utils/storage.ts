import Taro from '@tarojs/taro';

/**
 * 平台兼容的存储接口
 *
 * 提供统一的存储 API，屏蔽不同平台的差异
 *
 * **Validates: Requirements 3.3**
 */
export interface StorageAdapter {
  /**
   * 存储数据
   *
   * @param key 存储键名
   * @param value 存储值（字符串）
   * @returns Promise<void>
   */
  setItem(key: string, value: string): Promise<void>;

  /**
   * 获取数据
   *
   * @param key 存储键名
   * @returns Promise<string | null> 存储的值，不存在时返回 null
   */
  getItem(key: string): Promise<string | null>;

  /**
   * 删除数据
   *
   * @param key 存储键名
   * @returns Promise<void>
   */
  removeItem(key: string): Promise<void>;

  /**
   * 清空所有数据
   *
   * @returns Promise<void>
   */
  clear(): Promise<void>;
}

/**
 * 基于 Taro API 的存储适配器实现
 *
 * 使用 Taro.setStorage/getStorage 等 API 实现跨平台存储
 *
 * **特性：**
 * - 自动处理不同平台的存储 API 差异
 * - 统一的 Promise 接口
 * - 完善的错误处理
 * - 类型安全
 *
 * @example
 * ```typescript
 * const storage = new TaroStorageAdapter()
 *
 * // 存储数据
 * await storage.setItem('user', JSON.stringify({ name: '张三' }))
 *
 * // 读取数据
 * const userData = await storage.getItem('user')
 * if (userData) {
 *   const user = JSON.parse(userData)
 * }
 *
 * // 删除数据
 * await storage.removeItem('user')
 *
 * // 清空所有数据
 * await storage.clear()
 * ```
 *
 * **Validates: Requirements 3.3**
 */
export class TaroStorageAdapter implements StorageAdapter {
  /**
   * 存储数据到本地
   *
   * 使用 Taro.setStorage 将数据持久化到本地存储
   *
   * @param key 存储键名
   * @param value 存储值（字符串）
   * @throws {Error} 当存储失败时抛出错误
   *
   * @example
   * ```typescript
   * await storage.setItem('token', 'abc123')
   * ```
   */
  async setItem(key: string, value: string): Promise<void> {
    try {
      await Taro.setStorage({
        key,
        data: value,
      });
    } catch (error) {
      console.error('[Storage] Failed to set item:', {key, error});
      throw new Error(
        `存储数据失败: ${error instanceof Error ? error.message : '未知错误'}`,
      );
    }
  }

  /**
   * 从本地存储获取数据
   *
   * 使用 Taro.getStorage 读取本地存储的数据
   *
   * @param key 存储键名
   * @returns Promise<string | null> 存储的值，不存在时返回 null
   *
   * @example
   * ```typescript
   * const token = await storage.getItem('token')
   * if (token) {
   *   console.log('Token:', token)
   * }
   * ```
   */
  async getItem(key: string): Promise<string | null> {
    try {
      const result = await Taro.getStorage({key});
      return result.data as string;
    } catch (error: any) {
      // Taro.getStorage 在键不存在时会抛出错误
      // 我们将其转换为返回 null，保持接口一致性
      if (error?.errMsg?.includes('data not found')) {
        return null;
      }

      console.error('[Storage] Failed to get item:', {key, error});
      // 其他错误继续抛出
      throw new Error(
        `读取数据失败: ${error instanceof Error ? error.message : '未知错误'}`,
      );
    }
  }

  /**
   * 从本地存储删除数据
   *
   * 使用 Taro.removeStorage 删除指定键的数据
   *
   * @param key 存储键名
   * @throws {Error} 当删除失败时抛出错误
   *
   * @example
   * ```typescript
   * await storage.removeItem('token')
   * ```
   */
  async removeItem(key: string): Promise<void> {
    try {
      await Taro.removeStorage({key});
    } catch (error) {
      console.error('[Storage] Failed to remove item:', {key, error});
      throw new Error(
        `删除数据失败: ${error instanceof Error ? error.message : '未知错误'}`,
      );
    }
  }

  /**
   * 清空所有本地存储数据
   *
   * 使用 Taro.clearStorage 清空所有存储的数据
   *
   * ⚠️ **警告：此操作不可逆，会删除所有存储的数据**
   *
   * @throws {Error} 当清空失败时抛出错误
   *
   * @example
   * ```typescript
   * await storage.clear()
   * ```
   */
  async clear(): Promise<void> {
    try {
      await Taro.clearStorage();
    } catch (error) {
      console.error('[Storage] Failed to clear storage:', error);
      throw new Error(
        `清空存储失败: ${error instanceof Error ? error.message : '未知错误'}`,
      );
    }
  }
}

/**
 * 默认存储适配器实例
 *
 * 提供一个全局单例，方便在应用中直接使用
 * 使用懒加载模式避免在模块加载时初始化
 *
 * @example
 * ```typescript
 * import { storage } from '@/utils/storage'
 *
 * // 直接使用
 * await storage.setItem('key', 'value')
 * const value = await storage.getItem('key')
 * ```
 */
let _storageInstance: StorageAdapter | null = null;

export const storage: StorageAdapter = {
  async setItem(key: string, value: string): Promise<void> {
    if (!_storageInstance) {
      _storageInstance = new TaroStorageAdapter();
    }
    return _storageInstance.setItem(key, value);
  },

  async getItem(key: string): Promise<string | null> {
    if (!_storageInstance) {
      _storageInstance = new TaroStorageAdapter();
    }
    return _storageInstance.getItem(key);
  },

  async removeItem(key: string): Promise<void> {
    if (!_storageInstance) {
      _storageInstance = new TaroStorageAdapter();
    }
    return _storageInstance.removeItem(key);
  },

  async clear(): Promise<void> {
    if (!_storageInstance) {
      _storageInstance = new TaroStorageAdapter();
    }
    return _storageInstance.clear();
  },
};

/**
 * 存储工具函数：存储 JSON 对象
 *
 * 自动将对象序列化为 JSON 字符串后存储
 *
 * @param key 存储键名
 * @param value 要存储的对象
 * @throws {Error} 当序列化或存储失败时抛出错误
 *
 * @example
 * ```typescript
 * await setJSON('user', { name: '张三', age: 25 })
 * ```
 */
export async function setJSON<T>(key: string, value: T): Promise<void> {
  try {
    const jsonString = JSON.stringify(value);
    await storage.setItem(key, jsonString);
  } catch (error) {
    console.error('[Storage] Failed to set JSON:', {key, error});
    throw new Error(
      `存储 JSON 失败: ${error instanceof Error ? error.message : '未知错误'}`,
    );
  }
}

/**
 * 存储工具函数：获取 JSON 对象
 *
 * 自动将存储的 JSON 字符串反序列化为对象
 *
 * @param key 存储键名
 * @returns Promise<T | null> 反序列化后的对象，不存在时返回 null
 * @throws {Error} 当读取或反序列化失败时抛出错误
 *
 * @example
 * ```typescript
 * interface User {
 *   name: string
 *   age: number
 * }
 *
 * const user = await getJSON<User>('user')
 * if (user) {
 *   console.log(user.name)
 * }
 * ```
 */
export async function getJSON<T>(key: string): Promise<T | null> {
  try {
    const jsonString = await storage.getItem(key);
    if (jsonString === null) {
      return null;
    }

    return JSON.parse(jsonString) as T;
  } catch (error) {
    console.error('[Storage] Failed to get JSON:', {key, error});
    throw new Error(
      `读取 JSON 失败: ${error instanceof Error ? error.message : '未知错误'}`,
    );
  }
}

/**
 * 存储工具函数：检查键是否存在
 *
 * @param key 存储键名
 * @returns Promise<boolean> 键是否存在
 *
 * @example
 * ```typescript
 * if (await hasKey('token')) {
 *   console.log('用户已登录')
 * }
 * ```
 */
export async function hasKey(key: string): Promise<boolean> {
  try {
    const value = await storage.getItem(key);
    return value !== null;
  } catch (error) {
    console.error('[Storage] Failed to check key:', {key, error});
    return false;
  }
}

/**
 * 存储工具函数：获取所有存储的键名
 *
 * 使用 Taro.getStorageInfo 获取所有键名
 *
 * @returns Promise<string[]> 所有存储的键名数组
 *
 * @example
 * ```typescript
 * const keys = await getAllKeys()
 * console.log('存储的键:', keys)
 * ```
 */
export async function getAllKeys(): Promise<string[]> {
  try {
    const info = await Taro.getStorageInfo();
    return info.keys || [];
  } catch (error) {
    console.error('[Storage] Failed to get all keys:', error);
    throw new Error(
      `获取键列表失败: ${error instanceof Error ? error.message : '未知错误'}`,
    );
  }
}

/**
 * 清理业务缓存，保留引导完成标志和登录会话。
 * 登录态不是业务缓存，清理缓存不应意外退出当前账号。
 */
export async function clearBusinessCache(): Promise<number> {
  const landingSeenKey = 'reffo.landing.seen'
  const keys = await getAllKeys()
  const cacheKeys = keys.filter(key => (
    key !== landingSeenKey && !key.startsWith('reffo.auth.session.')
  ))

  await Promise.all(cacheKeys.map(key => storage.removeItem(key)))
  return cacheKeys.length
}

/**
 * 存储工具函数：获取存储信息
 *
 * 获取当前存储的统计信息（键数量、占用空间等）
 *
 * @returns Promise<StorageInfo> 存储信息对象
 *
 * @example
 * ```typescript
 * const info = await getStorageInfo()
 * console.log(`存储了 ${info.keys.length} 个键`)
 * console.log(`占用空间: ${info.currentSize}KB / ${info.limitSize}KB`)
 * ```
 */
export async function getStorageInfo(): Promise<{
  keys: string[];
  currentSize: number;
  limitSize: number;
}> {
  try {
    const info = await Taro.getStorageInfo();
    return {
      keys: info.keys || [],
      currentSize: info.currentSize || 0,
      limitSize: info.limitSize || 0,
    };
  } catch (error) {
    console.error('[Storage] Failed to get storage info:', error);
    throw new Error(
      `获取存储信息失败: ${error instanceof Error ? error.message : '未知错误'}`,
    );
  }
}
