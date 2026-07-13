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
  getCurrentPages: jest.fn(() => []),
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

export const request = Taro.request
export const showToast = Taro.showToast
export const showModal = Taro.showModal
export const showLoading = Taro.showLoading
export const hideLoading = Taro.hideLoading
export const showShareMenu = Taro.showShareMenu
export const navigateTo = Taro.navigateTo
export const navigateBack = Taro.navigateBack
export const redirectTo = Taro.redirectTo
export const switchTab = Taro.switchTab
export const reLaunch = Taro.reLaunch
export const getCurrentPages = Taro.getCurrentPages
export const getSystemInfoSync = Taro.getSystemInfoSync
export const chooseMessageFile = Taro.chooseMessageFile
export const setStorage = Taro.setStorage
export const getStorage = Taro.getStorage
export const removeStorage = Taro.removeStorage
export const clearStorage = Taro.clearStorage
export const getStorageInfo = Taro.getStorageInfo
export const getFileSystemManager = Taro.getFileSystemManager

export default Taro
