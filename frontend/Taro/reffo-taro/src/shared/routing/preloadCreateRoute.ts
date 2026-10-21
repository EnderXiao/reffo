import {scheduleIdle} from '@/utils/schedule-idle'

let createRoutePromise: Promise<unknown> | null = null

export function preloadCreateRoute() {
  if (!createRoutePromise) {
    createRoutePromise = import('@/pages/create/index').catch(error => {
      createRoutePromise = null
      throw error
    })
  }

  return createRoutePromise
}

export function scheduleCreateRoutePreload() {
  return scheduleIdle(() => {
    void preloadCreateRoute().catch(() => undefined)
  }, 2800)
}
