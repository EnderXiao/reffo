import {useAuthStore} from '@/store/authStore'
import {useHistoryStore} from '@/store/historyStore'
import {useSourceResumeStore} from '@/store/sourceResumeStore'
import {syncPendingLandingData} from '@/utils/pending-landing-data'

let bootstrapPromise: Promise<void> | null = null
let hasBootstrapped = false

export function hasBootstrappedHomeData() {
  return hasBootstrapped
}

function startBootstrap(force: boolean): Promise<void> {
  const previous = bootstrapPromise
  const next = (async () => {
    await previous?.catch(() => undefined)
    const session = await useAuthStore.getState().restoreSession()

    if (session) {
      try {
        await syncPendingLandingData()
      } catch (error) {
        console.warn('[HomeDataBootstrap] 同步 Landing 本地数据失败:', error)
      }
    }

    await Promise.all([
      useHistoryStore.getState().loadHistorySummaries({
        force,
        skipIfLoaded: !force,
      }),
      useSourceResumeStore.getState().loadLatestSourceSummary({
        force,
        skipIfLoaded: !force,
      }),
      useAuthStore.getState().loadProfile(),
    ])
  })().catch(error => {
    console.warn('[HomeDataBootstrap] 首页数据准备失败:', error)
  }).finally(() => {
    if (bootstrapPromise === next) {
      bootstrapPromise = null
    }
    hasBootstrapped = true
  })

  bootstrapPromise = next
  return next
}

export function bootstrapHomeData(): Promise<void> {
  return bootstrapPromise || startBootstrap(false)
}

export function refreshHomeData(): Promise<void> {
  const pending = bootstrapPromise
  return pending
    ? pending.then(() => startBootstrap(true))
    : startBootstrap(true)
}
