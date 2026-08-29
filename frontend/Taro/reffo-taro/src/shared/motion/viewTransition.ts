import {flushSync} from 'react-dom'

export type ViewTransitionKind = 'forward' | 'back' | 'replace' | 'root'

interface ViewTransitionDocument extends Document {
  startViewTransition?: (callback: () => void) => {
    ready: Promise<void>
    finished: Promise<void>
    updateCallbackDone: Promise<void>
  }
}

export async function runViewTransition(
  kind: ViewTransitionKind,
  update: () => void,
) {
  if (typeof document === 'undefined') {
    update()
    return
  }

  const root = document.documentElement
  root.dataset.reffoViewTransition = kind
  const start = (document as ViewTransitionDocument).startViewTransition

  const cleanup = () => {
    delete root.dataset.reffoViewTransition
  }

  const reducedMotion = typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

  if (!start || reducedMotion) {
    try {
      update()
    } finally {
      cleanup()
    }
    return
  }

  try {
    // View Transition API is a Web IDL method; preserve document as `this`.
    const transition = start.call(document, () => flushSync(update))
    void transition.ready.catch(() => undefined)
    void transition.updateCallbackDone.catch(() => undefined)
    await transition.finished.catch(() => undefined)
  } catch {
    update()
  } finally {
    cleanup()
  }
}
