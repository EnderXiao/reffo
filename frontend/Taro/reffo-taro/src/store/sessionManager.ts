import {clearPersistedUserData} from '@/utils/user-data-storage'

type ResetHandler = () => void | Promise<void>

const resetHandlers = new Set<ResetHandler>()
let defaultHandlersRegistered = false

async function registerDefaultResetHandlers() {
  if (defaultHandlersRegistered) return
  defaultHandlersRegistered = true
  const [history, sourceResume, workspace, landing] = await Promise.all([
    import('./historyStore'),
    import('./sourceResumeStore'),
    import('./resumeWorkspaceStore'),
    import('./landingFlowStore'),
  ])
  registerSessionResetHandler(() => history.useHistoryStore.getState().reset())
  registerSessionResetHandler(() => sourceResume.useSourceResumeStore.getState().reset())
  registerSessionResetHandler(() => workspace.useResumeWorkspaceStore.getState().reset())
  registerSessionResetHandler(() => landing.useLandingFlowStore.getState().clear())
}

export function registerSessionResetHandler(handler: ResetHandler) {
  resetHandlers.add(handler)
  return () => resetHandlers.delete(handler)
}

export async function clearUserSessionData(userId?: string | null) {
  await registerDefaultResetHandlers()
  const results = await Promise.allSettled(
    Array.from(resetHandlers, handler => Promise.resolve().then(handler)),
  )
  await clearPersistedUserData(userId)

  const failure = results.find(result => result.status === 'rejected')
  if (failure?.status === 'rejected') {
    throw failure.reason
  }
}
