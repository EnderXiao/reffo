import {describe, test, expect, beforeEach, jest} from '@jest/globals';
import Taro from '@tarojs/taro';
import {
  TaroStorageAdapter,
  storage,
  setJSON,
  getJSON,
  hasKey,
  getAllKeys,
  getStorageInfo,
} from '../storage';

// Mock Taro API
jest.mock('@tarojs/taro', () => ({
  setStorage: jest.fn(),
  getStorage: jest.fn(),
  removeStorage: jest.fn(),
  clearStorage: jest.fn(),
  getStorageInfo: jest.fn(),
}));

describe('TaroStorageAdapter', () => {
  let adapter: TaroStorageAdapter;

  beforeEach(() => {
    // 重置所有 mock
    jest.clearAllMocks();
    adapter = new TaroStorageAdapter();
  });

  describe('setItem', () => {
    test('should store data successfully', async () => {
      (Taro.setStorage as jest.Mock).mockResolvedValue(undefined);

      await adapter.setItem('test-key', 'test-value');

      expect(Taro.setStorage).toHaveBeenCalledWith({
        key: 'test-key',
        data: 'test-value',
      });
    });

    test('should throw error when storage fails', async () => {
      (Taro.setStorage as jest.Mock).mockRejectedValue(
        new Error('Storage full'),
      );

      await expect(adapter.setItem('test-key', 'test-value')).rejects.toThrow(
        '存储数据失败',
      );
    });
  });

  describe('getItem', () => {
    test('should retrieve stored data', async () => {
      (Taro.getStorage as jest.Mock).mockResolvedValue({data: 'test-value'});

      const result = await adapter.getItem('test-key');

      expect(result).toBe('test-value');
      expect(Taro.getStorage).toHaveBeenCalledWith({key: 'test-key'});
    });

    test('should return null when key does not exist', async () => {
      (Taro.getStorage as jest.Mock).mockRejectedValue({
        errMsg: 'getStorage:fail data not found',
      });

      const result = await adapter.getItem('non-existent-key');

      expect(result).toBeNull();
    });

    test('should throw error for other failures', async () => {
      (Taro.getStorage as jest.Mock).mockRejectedValue(
        new Error('Network error'),
      );

      await expect(adapter.getItem('test-key')).rejects.toThrow('读取数据失败');
    });
  });

  describe('removeItem', () => {
    test('should remove data successfully', async () => {
      (Taro.removeStorage as jest.Mock).mockResolvedValue(undefined);

      await adapter.removeItem('test-key');

      expect(Taro.removeStorage).toHaveBeenCalledWith({key: 'test-key'});
    });

    test('should throw error when removal fails', async () => {
      (Taro.removeStorage as jest.Mock).mockRejectedValue(
        new Error('Remove failed'),
      );

      await expect(adapter.removeItem('test-key')).rejects.toThrow(
        '删除数据失败',
      );
    });
  });

  describe('clear', () => {
    test('should clear all data successfully', async () => {
      (Taro.clearStorage as jest.Mock).mockResolvedValue(undefined);

      await adapter.clear();

      expect(Taro.clearStorage).toHaveBeenCalled();
    });

    test('should throw error when clear fails', async () => {
      (Taro.clearStorage as jest.Mock).mockRejectedValue(
        new Error('Clear failed'),
      );

      await expect(adapter.clear()).rejects.toThrow('清空存储失败');
    });
  });
});

describe('Storage singleton', () => {
  test('should export a default storage instance', () => {
    expect(storage).toBeInstanceOf(TaroStorageAdapter);
  });
});

describe('setJSON and getJSON', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should store and retrieve JSON object', async () => {
    const testObject = {
      name: '张三',
      age: 25,
      skills: ['JavaScript', 'TypeScript'],
    };
    const jsonString = JSON.stringify(testObject);

    (Taro.setStorage as jest.Mock).mockResolvedValue(undefined);
    (Taro.getStorage as jest.Mock).mockResolvedValue({data: jsonString});

    // 存储对象
    await setJSON('user', testObject);
    expect(Taro.setStorage).toHaveBeenCalledWith({
      key: 'user',
      data: jsonString,
    });

    // 读取对象
    const result = await getJSON<typeof testObject>('user');
    expect(result).toEqual(testObject);
  });

  test('should return null when JSON key does not exist', async () => {
    (Taro.getStorage as jest.Mock).mockRejectedValue({
      errMsg: 'getStorage:fail data not found',
    });

    const result = await getJSON('non-existent');
    expect(result).toBeNull();
  });

  test('should throw error when JSON parsing fails', async () => {
    (Taro.getStorage as jest.Mock).mockResolvedValue({
      data: 'invalid json {',
    });

    await expect(getJSON('invalid')).rejects.toThrow('读取 JSON 失败');
  });

  test('should throw error when JSON serialization fails', async () => {
    // 创建一个循环引用对象，会导致 JSON.stringify 失败
    const circular: any = {name: 'test'};
    circular.self = circular;

    await expect(setJSON('circular', circular)).rejects.toThrow(
      '存储 JSON 失败',
    );
  });
});

describe('hasKey', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should return true when key exists', async () => {
    (Taro.getStorage as jest.Mock).mockResolvedValue({data: 'some-value'});

    const result = await hasKey('existing-key');
    expect(result).toBe(true);
  });

  test('should return false when key does not exist', async () => {
    (Taro.getStorage as jest.Mock).mockRejectedValue({
      errMsg: 'getStorage:fail data not found',
    });

    const result = await hasKey('non-existent-key');
    expect(result).toBe(false);
  });

  test('should return false on error', async () => {
    (Taro.getStorage as jest.Mock).mockRejectedValue(
      new Error('Network error'),
    );

    const result = await hasKey('error-key');
    expect(result).toBe(false);
  });
});

describe('getAllKeys', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should return all storage keys', async () => {
    const keys = ['key1', 'key2', 'key3'];
    (Taro.getStorageInfo as jest.Mock).mockResolvedValue({
      keys,
      currentSize: 10,
      limitSize: 1024,
    });

    const result = await getAllKeys();
    expect(result).toEqual(keys);
  });

  test('should return empty array when no keys exist', async () => {
    (Taro.getStorageInfo as jest.Mock).mockResolvedValue({
      keys: [],
      currentSize: 0,
      limitSize: 1024,
    });

    const result = await getAllKeys();
    expect(result).toEqual([]);
  });

  test('should throw error when getStorageInfo fails', async () => {
    (Taro.getStorageInfo as jest.Mock).mockRejectedValue(
      new Error('Info failed'),
    );

    await expect(getAllKeys()).rejects.toThrow('获取键列表失败');
  });
});

describe('getStorageInfo', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should return storage information', async () => {
    const info = {
      keys: ['key1', 'key2'],
      currentSize: 50,
      limitSize: 1024,
    };
    (Taro.getStorageInfo as jest.Mock).mockResolvedValue(info);

    const result = await getStorageInfo();
    expect(result).toEqual(info);
  });

  test('should handle missing fields in storage info', async () => {
    (Taro.getStorageInfo as jest.Mock).mockResolvedValue({});

    const result = await getStorageInfo();
    expect(result).toEqual({
      keys: [],
      currentSize: 0,
      limitSize: 0,
    });
  });

  test('should throw error when getStorageInfo fails', async () => {
    (Taro.getStorageInfo as jest.Mock).mockRejectedValue(
      new Error('Info failed'),
    );

    await expect(getStorageInfo()).rejects.toThrow('获取存储信息失败');
  });
});

/**
 * Property 2: 状态持久化往返
 *
 * **Validates: Requirements 6.4**
 *
 * 对于任何应用状态数据，保存到本地存储后再读取，应该得到等价的数据对象
 */
describe('Property 2: State Persistence Round-trip', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should preserve data integrity for simple objects', async () => {
    const originalData = {
      id: '123',
      name: '测试用户',
      score: 85,
      active: true,
    };

    // 模拟存储和读取
    let storedData: string = '';
    (Taro.setStorage as jest.Mock).mockImplementation(async ({data}) => {
      storedData = data;
    });
    (Taro.getStorage as jest.Mock).mockImplementation(async () => {
      return {data: storedData};
    });

    // 存储
    await setJSON('test-data', originalData);

    // 读取
    const retrievedData = await getJSON<typeof originalData>('test-data');

    // 验证数据完整性
    expect(retrievedData).toEqual(originalData);
  });

  test('should preserve data integrity for complex nested objects', async () => {
    const originalData = {
      user: {
        id: '456',
        profile: {
          name: '李四',
          age: 30,
          tags: ['developer', 'designer'],
        },
      },
      settings: {
        theme: 'dark',
        notifications: true,
      },
      history: [
        {id: '1', date: '2024-01-01'},
        {id: '2', date: '2024-01-02'},
      ],
    };

    // 模拟存储和读取
    let storedData: string = '';
    (Taro.setStorage as jest.Mock).mockImplementation(async ({data}) => {
      storedData = data;
    });
    (Taro.getStorage as jest.Mock).mockImplementation(async () => {
      return {data: storedData};
    });

    // 存储
    await setJSON('complex-data', originalData);

    // 读取
    const retrievedData = await getJSON<typeof originalData>('complex-data');

    // 验证数据完整性
    expect(retrievedData).toEqual(originalData);
    expect(retrievedData?.user.profile.tags).toEqual(['developer', 'designer']);
    expect(retrievedData?.history.length).toBe(2);
  });

  test('should preserve data types correctly', async () => {
    const originalData = {
      stringValue: 'hello',
      numberValue: 42,
      booleanValue: true,
      nullValue: null,
      arrayValue: [1, 2, 3],
      objectValue: {nested: 'value'},
    };

    // 模拟存储和读取
    let storedData: string = '';
    (Taro.setStorage as jest.Mock).mockImplementation(async ({data}) => {
      storedData = data;
    });
    (Taro.getStorage as jest.Mock).mockImplementation(async () => {
      return {data: storedData};
    });

    // 存储
    await setJSON('typed-data', originalData);

    // 读取
    const retrievedData = await getJSON<typeof originalData>('typed-data');

    // 验证类型
    expect(typeof retrievedData?.stringValue).toBe('string');
    expect(typeof retrievedData?.numberValue).toBe('number');
    expect(typeof retrievedData?.booleanValue).toBe('boolean');
    expect(retrievedData?.nullValue).toBeNull();
    expect(Array.isArray(retrievedData?.arrayValue)).toBe(true);
    expect(typeof retrievedData?.objectValue).toBe('object');
  });

  test('should handle empty objects and arrays', async () => {
    const originalData = {
      emptyObject: {},
      emptyArray: [],
      emptyString: '',
    };

    // 模拟存储和读取
    let storedData: string = '';
    (Taro.setStorage as jest.Mock).mockImplementation(async ({data}) => {
      storedData = data;
    });
    (Taro.getStorage as jest.Mock).mockImplementation(async () => {
      return {data: storedData};
    });

    // 存储
    await setJSON('empty-data', originalData);

    // 读取
    const retrievedData = await getJSON<typeof originalData>('empty-data');

    // 验证
    expect(retrievedData).toEqual(originalData);
    expect(Object.keys(retrievedData?.emptyObject || {}).length).toBe(0);
    expect(retrievedData?.emptyArray.length).toBe(0);
    expect(retrievedData?.emptyString).toBe('');
  });
});
