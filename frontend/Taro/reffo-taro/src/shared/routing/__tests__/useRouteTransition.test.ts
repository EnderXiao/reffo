import {act, renderHook} from '@testing-library/react'
import {beforeEach, describe, expect, jest, test} from '@jest/globals'
import {navigation} from '@/utils/navigation'
import {routePaths} from '../routePaths'
import {useRouteTransition} from '../useRouteTransition'

jest.mock('@/utils/navigation', () => ({
  navigation: {
    navigateTo: jest.fn(),
    redirectTo: jest.fn(),
    navigateBack: jest.fn(),
    reLaunch: jest.fn(),
  },
}))

describe('useRouteTransition', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.mocked(navigation.navigateTo).mockResolvedValue(undefined)
    jest.mocked(navigation.redirectTo).mockResolvedValue(undefined)
    jest.mocked(navigation.navigateBack).mockResolvedValue(undefined)
    jest.mocked(navigation.reLaunch).mockResolvedValue(undefined)
  })

  test('通过公共路径和参数调用导航 transport', async () => {
    const {result} = renderHook(() => useRouteTransition())

    await act(async () => {
      await result.current.navigate(routePaths.result, {id: 'history-1'})
      await result.current.replace(routePaths.create, {step: 'jobDescription'})
      await result.current.back(2)
      await result.current.reset(routePaths.home)
    })

    expect(navigation.navigateTo).toHaveBeenCalledWith(routePaths.result, {id: 'history-1'})
    expect(navigation.redirectTo).toHaveBeenCalledWith(routePaths.create, {step: 'jobDescription'})
    expect(navigation.navigateBack).toHaveBeenCalledWith(2)
    expect(navigation.reLaunch).toHaveBeenCalledWith(routePaths.home, undefined)
  })

  test('导航错误向调用方回退', async () => {
    const error = new Error('导航失败')
    jest.mocked(navigation.navigateTo).mockRejectedValueOnce(error)
    const {result} = renderHook(() => useRouteTransition())

    await expect(act(async () => {
      await result.current.navigate(routePaths.result)
    })).rejects.toBe(error)
  })
})
