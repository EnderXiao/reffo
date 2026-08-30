import {useMemo} from 'react'
import {useRouter} from '@tarojs/taro'
import {readRouteBoolean, readRouteNumber, readRouteString} from './routeParams'

export function usePageRoute() {
  const router = useRouter()
  const params = router.params as Record<string, unknown>

  return useMemo(() => ({
    path: router.path,
    params,
    readString: (key: string) => readRouteString(params, key),
    readBoolean: (key: string) => readRouteBoolean(params, key),
    readNumber: (key: string) => readRouteNumber(params, key),
  }), [params, router.path])
}
