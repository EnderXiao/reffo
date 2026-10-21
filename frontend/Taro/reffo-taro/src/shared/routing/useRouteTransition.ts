import {useCallback, useMemo} from 'react'
import {navigation, type NavigationParams} from '@/utils/navigation'
import {routePaths, type RoutePath} from './routePaths'

export function useRouteTransition() {
  const navigate = useCallback(async (
    path: RoutePath | string,
    params?: NavigationParams,
  ): Promise<void> => {
    await navigation.navigateTo(path, params)
  },
    [],
  )

  const replace = useCallback(async (
    path: RoutePath | string,
    params?: NavigationParams,
  ): Promise<void> => {
    await navigation.redirectTo(path, params)
  },
    [],
  )

  const back = useCallback(async (delta = 1): Promise<void> => {
    if (navigation.canGoBack()) {
      await navigation.navigateBack(delta)
      return
    }

    await navigation.reLaunch(routePaths.home)
  }, [])

  const reset = useCallback(async (
    path: RoutePath | string,
    params?: NavigationParams,
  ): Promise<void> => {
    await navigation.reLaunch(path, params)
  }, [])

  return useMemo(() => ({navigate, replace, back, reset}), [back, navigate, replace, reset])
}
