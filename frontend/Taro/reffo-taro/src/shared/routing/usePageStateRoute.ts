import {useCallback, useState} from 'react'
import {runViewTransition, type ViewTransitionKind} from '@/shared/motion'

export function usePageStateRoute<T extends {kind: string}>(initialState: T) {
  const [state, setState] = useState<T>(initialState)

  const transitionTo = useCallback(async (
    nextState: T,
    kind: ViewTransitionKind = 'forward',
  ): Promise<void> => {
    await runViewTransition(kind, () => setState(nextState))
  }, [])

  return {state, transitionTo}
}
