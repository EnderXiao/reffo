/* eslint-disable */
/**
 * H5 mock for expo-image-picker
 *
 * Keeps lazy imports browser-safe. The app should use Taro/Web file inputs for
 * production H5 uploads; this fallback reports cancel when no native picker exists.
 */
export const MediaTypeOptions = {
  All: 'All',
  Videos: 'Videos',
  Images: 'Images',
}

export const PermissionStatus = {
  GRANTED: 'granted',
  UNDETERMINED: 'undetermined',
  DENIED: 'denied',
}

export async function requestMediaLibraryPermissionsAsync() {
  return {granted: true, status: PermissionStatus.GRANTED, canAskAgain: true}
}

export async function getMediaLibraryPermissionsAsync() {
  return {granted: true, status: PermissionStatus.GRANTED, canAskAgain: true}
}

export async function launchImageLibraryAsync() {
  return {canceled: true, assets: []}
}

export default {
  MediaTypeOptions,
  PermissionStatus,
  requestMediaLibraryPermissionsAsync,
  getMediaLibraryPermissionsAsync,
  launchImageLibraryAsync,
}
