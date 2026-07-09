import React from 'react'

export const State = {
  UNDETERMINED: 0,
  FAILED: 1,
  BEGAN: 2,
  CANCELLED: 3,
  ACTIVE: 4,
  END: 5,
}

export function PanGestureHandler({children}: any) {
  return <div>{children}</div>
}

export function GestureHandlerRootView({children}: any) {
  return <div>{children}</div>
}
