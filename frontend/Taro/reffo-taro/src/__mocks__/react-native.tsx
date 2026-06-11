import React from 'react'

function normalizeProps(props: Record<string, unknown>) {
  const {
    hitSlop,
    contentContainerStyle,
    scrollEnabled,
    showsVerticalScrollIndicator,
    bounces,
    pointerEvents,
    renderToHardwareTextureAndroid,
    shouldRasterizeIOS,
    onLayout,
    testID,
    ...rest
  } = props

  return {
    ...(rest as Record<string, unknown>),
    ...(testID ? {'data-testid': testID} : null),
  }
}

const MockView = ({children, onPress, onClick, ...props}: any) => {
  const normalizedProps = normalizeProps(props)

  return (
    <div onClick={onPress || onClick} {...normalizedProps}>
      {children}
    </div>
  )
}

const MockText = ({children, ...props}: any) => <span {...props}>{children}</span>

class MockAnimatedValue {
  private value: number

  constructor(initialValue: number) {
    this.value = initialValue
  }

  setValue = (nextValue: number) => {
    this.value = nextValue
  }

  interpolate = () => 0
}

const startImmediately = (callback?: (result: {finished: boolean}) => void) => {
  callback?.({finished: true})
}

const createAnimation = () => ({
  start: startImmediately,
  stop: jest.fn(),
})

export const Animated = {
  Value: MockAnimatedValue,
  View: MockView,
  Text: MockText,
  ScrollView: MockView,
  Image: MockView,
  timing: createAnimation,
  spring: createAnimation,
  parallel: createAnimation,
  sequence: createAnimation,
  loop: createAnimation,
  event: () => jest.fn(),
  createAnimatedComponent: (Component: any) => Component,
}

export const Easing = {
  bezier: () => 'bezier',
  out: (value: unknown) => value,
  cubic: 'cubic',
  linear: 'linear',
}

export const StyleSheet = {
  create: (styles: Record<string, unknown>) => styles,
  absoluteFill: {},
  absoluteFillObject: {},
  hairlineWidth: 1,
}

export const Platform = {
  OS: 'ios',
  select: (config: Record<string, unknown>) => config.ios ?? config.default,
}

export const StatusBar = Object.assign(() => null, {
  currentHeight: 0,
})

export const useWindowDimensions = () => ({
  width: 393,
  height: 852,
  scale: 2,
  fontScale: 1,
})

export const Dimensions = {
  get: () => ({
    width: 393,
    height: 852,
    scale: 2,
    fontScale: 1,
  }),
  addEventListener: jest.fn(() => ({
    remove: jest.fn(),
  })),
}

export const PanResponder = {
  create: () => ({
    panHandlers: {},
  }),
}

export const View = MockView
export const Text = MockText
export const ScrollView = MockView
export const Image = MockView
export const Pressable = MockView

export default {
  Animated,
  Easing,
  StyleSheet,
  Platform,
  StatusBar,
  useWindowDimensions,
  Dimensions,
  PanResponder,
  View,
  Text,
  ScrollView,
  Image,
  Pressable,
}
