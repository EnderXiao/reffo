/**
 * Mock @tarojs/taro for Jest tests
 */

const mockStorage = new Map<string, unknown>()

const Taro = {
  request: jest.fn(),
  showToast: jest.fn(),
  showModal: jest.fn(),
  showLoading: jest.fn(),
  hideLoading: jest.fn(),
  showShareMenu: jest.fn(),
  navigateTo: jest.fn(),
  navigateBack: jest.fn(),
  redirectTo: jest.fn(),
  switchTab: jest.fn(),
  reLaunch: jest.fn(),
  getSystemInfoSync: jest.fn(() => ({
    platform: 'ios',
  })),
  chooseMessageFile: jest.fn(),
  setStorage: jest.fn(async ({key, data}) => {
    mockStorage.set(key, data)
  }),
  getStorage: jest.fn(async ({key}) => {
    if (!mockStorage.has(key)) {
      throw {errMsg: 'getStorage:fail data not found'}
    }

    return {data: mockStorage.get(key)}
  }),
  removeStorage: jest.fn(async ({key}) => {
    mockStorage.delete(key)
  }),
  clearStorage: jest.fn(async () => {
    mockStorage.clear()
  }),
  getStorageInfo: jest.fn(async () => ({
    keys: Array.from(mockStorage.keys()),
    currentSize: 0,
    limitSize: 0,
  })),
  getFileSystemManager: jest.fn(() => ({
    readFile: jest.fn(),
  })),
}

export const useDidShow = jest.fn()
export const useRouter = jest.fn(() => ({
  params: {},
}))

export default Taro
