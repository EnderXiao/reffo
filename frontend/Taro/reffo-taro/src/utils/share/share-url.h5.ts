import {routePaths} from '@/shared/routing'

export function buildShareLandingUrl(token: string, currentHref?: string) {
  if (typeof window === 'undefined' && !currentHref) {
    throw new Error('分享链接仅支持在 H5 环境生成')
  }

  const currentUrl = new URL(currentHref || window.location.href)
  currentUrl.search = ''
  currentUrl.hash = `${routePaths.shareLanding}?shareToken=${encodeURIComponent(token)}`
  return currentUrl.toString()
}
