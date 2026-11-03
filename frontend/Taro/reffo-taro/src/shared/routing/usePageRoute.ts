import {useMemo} from 'react'
import {useRouter} from '@tarojs/taro'
import {readRouteBoolean, readRouteNumber, readRouteString} from './routeParams'

function readHashRouteParams() {
  if (typeof window === 'undefined') return {}

  const hash = window.location.hash || ''
  const queryIndex = hash.indexOf('?')
  if (queryIndex < 0) return {}

  const params: Record<string, string> = {}
  new URLSearchParams(hash.slice(queryIndex + 1)).forEach((value, key) => {
    params[key] = value
  })
  return params
}

export function usePageRoute() {
  const router = useRouter()
  const routerParams = Object.fromEntries(
    Object.entries(router.params as Record<string, unknown>)
      .filter(([, value]) => value !== undefined),
  )
  const params = {
    ...readHashRouteParams(),
    ...routerParams,
  }

  return useMemo(() => ({
    path: router.path,
    params,
    readString: (key: string) => readRouteString(params, key),
    readBoolean: (key: string) => readRouteBoolean(params, key),
    readNumber: (key: string) => readRouteNumber(params, key),
  }), [params, router.path])
}
