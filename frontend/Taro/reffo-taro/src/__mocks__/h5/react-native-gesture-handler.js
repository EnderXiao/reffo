/* eslint-disable */
/**
 * H5 mock for react-native-gesture-handler
 *
 * Provides browser-compatible stubs. GestureHandlerRootView renders children directly.
 */
import React from 'react'

export const GestureHandlerRootView = ({children}) => React.createElement('div', null, children)
export const GestureHandlerGestureView = ({children}) => React.createElement('div', null, children)
export const PanGestureHandler = ({children}) => React.createElement('div', null, children)
export const TapGestureHandler = ({children}) => React.createElement('div', null, children)
export const LongPressGestureHandler = ({children}) => React.createElement('div', null, children)
export const FlingGestureHandler = ({children}) => React.createElement('div', null, children)
export const PinchGestureHandler = ({children}) => React.createElement('div', null, children)
export const RotationGestureHandler = ({children}) => React.createElement('div', null, children)

export const State = {UNDETERMINED: 0, FAILED: 1, BEGAN: 2, CANCELLED: 3, ACTIVE: 4, END: 5}

export const Gesture = () => ({})
export const GestureDetector = ({children}) => React.createElement('div', null, children)

export default {
  GestureHandlerRootView,
  GestureHandlerGestureView,
  PanGestureHandler,
  TapGestureHandler,
  LongPressGestureHandler,
  FlingGestureHandler,
  PinchGestureHandler,
  RotationGestureHandler,
  State,
  Gesture,
  GestureDetector,
}
