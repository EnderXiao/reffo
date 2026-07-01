/* eslint-disable */
/**
 * H5 mock for expo-file-system
 */
export const documentDirectory = null
export const cacheDirectory = null
export const bundleDirectory = null

export async function getInfoAsync(uri) {
  return {exists: Boolean(uri), uri, size: 0, isDirectory: false}
}

export async function readAsStringAsync() {
  throw new Error('H5 文件读取请使用浏览器 File API')
}

export default {
  documentDirectory,
  cacheDirectory,
  bundleDirectory,
  getInfoAsync,
  readAsStringAsync,
}
