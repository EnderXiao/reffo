/* eslint-disable */
/**
 * H5 mock for react-native
 *
 * Provides browser-compatible stubs for react-native APIs used by the app.
 * Converts RN style objects/arrays to DOM-compatible style objects.
 */
import React from 'react'

const noop = () => {}

/**
 * 将 React Native 样式对象/数组转为浏览器可用的 style 对象
 * RN StyleSheet.create 返回的是普通对象，但 style prop 可能是数组
 */
export function toCSSStyle(style) {
  if (!style) return undefined
  if (typeof style === 'string') return undefined

  let flat = {}
  if (Array.isArray(style)) {
    style.forEach(s => {
      const normalized = toCSSStyle(s)
      if (normalized && typeof normalized === 'object') Object.assign(flat, normalized)
    })
  } else if (typeof style === 'object') {
    flat = style
  }

  const domStyle = {}
  let shadowColor
  let shadowOffset
  let shadowOpacity
  let shadowRadius

  for (const [key, val] of Object.entries(flat)) {
    if (val === undefined || val === null) continue
    // 跳过 RN 专有属性
    if (['elevation', 'overlayColor', 'tintColor', 'resizeMode'].includes(key)) continue
    if (key === 'shadowColor') {
      shadowColor = val
      continue
    }
    if (key === 'shadowOffset') {
      shadowOffset = val
      continue
    }
    if (key === 'shadowOpacity') {
      shadowOpacity = val
      continue
    }
    if (key === 'shadowRadius') {
      shadowRadius = val
      continue
    }

    if (key === 'transform' && Array.isArray(val)) {
      domStyle.transform = val
        .map(item => {
          const [[name, value]] = Object.entries(item || {})
          if (!name) return ''
          const cssValue =
            typeof value === 'number' && !['scale', 'scaleX', 'scaleY', 'scaleZ'].includes(name)
              ? `${value}px`
              : value
          return `${name}(${cssValue})`
        })
        .filter(Boolean)
        .join(' ')
      continue
    }

    domStyle[key] = val
  }

  if (
    domStyle.flex !== undefined ||
    domStyle.flexDirection ||
    domStyle.alignItems ||
    domStyle.justifyContent ||
    domStyle.flexWrap ||
    domStyle.gap !== undefined
  ) {
    domStyle.display = domStyle.display || 'flex'
  }

  if (domStyle.flex !== undefined && domStyle.display === 'flex') {
    domStyle.minHeight = domStyle.minHeight ?? 0
    domStyle.minWidth = domStyle.minWidth ?? 0
  }

  if (shadowColor && (shadowOpacity || shadowRadius || shadowOffset)) {
    const offset = shadowOffset && typeof shadowOffset === 'object' ? shadowOffset : {}
    const offsetX = Number(offset.width || 0)
    const offsetY = Number(offset.height || 0)
    const radius = Number(shadowRadius || 0)
    const opacity = Number(shadowOpacity ?? 1)
    domStyle.boxShadow = `${offsetX}px ${offsetY}px ${radius}px ${rgbaFromColor(shadowColor, opacity)}`
  }

  return Object.keys(domStyle).length > 0 ? domStyle : undefined
}

function rgbaFromColor(color, opacity) {
  if (typeof color !== 'string') return `rgba(0, 0, 0, ${opacity})`
  if (color.startsWith('rgba(')) return color
  if (color.startsWith('rgb(')) return color.replace('rgb(', 'rgba(').replace(')', `, ${opacity})`)
  if (/^#[0-9a-f]{6}$/i.test(color)) {
    const red = parseInt(color.slice(1, 3), 16)
    const green = parseInt(color.slice(3, 5), 16)
    const blue = parseInt(color.slice(5, 7), 16)
    return `rgba(${red}, ${green}, ${blue}, ${opacity})`
  }
  if (/^#[0-9a-f]{3}$/i.test(color)) {
    const red = parseInt(color[1] + color[1], 16)
    const green = parseInt(color[2] + color[2], 16)
    const blue = parseInt(color[3] + color[3], 16)
    return `rgba(${red}, ${green}, ${blue}, ${opacity})`
  }
  return color
}

// 通用组件工厂：返回 div 的 React 组件
function createMockComponent(tag = 'div') {
  return React.forwardRef(function MockComponent({children, style, ...props}, ref) {
    const {
      hitSlop, contentContainerStyle, scrollEnabled, showsVerticalScrollIndicator,
      bounces, pointerEvents, renderToHardwareTextureAndroid, shouldRasterizeIOS,
      onLayout, testID, collapsable, importantForAccessibility, accessibilityLabel,
      nativeID, nextFocusDown, nextFocusForward, nextFocusLeft, nextFocusRight,
      hasTVPreferredFocus, tvParallaxProperties, onPress, onPressIn, onPressOut,
      onLongPress, disabled, ...rest
    } = props
    const domProps = {...rest}
    if (testID) domProps['data-testid'] = testID
    if (onPress && !domProps.onClick) domProps.onClick = disabled ? undefined : onPress

    const cssStyle = toCSSStyle(style) || {}
    if (pointerEvents) cssStyle.pointerEvents = pointerEvents
    if (disabled) {
      cssStyle.pointerEvents = 'none'
      cssStyle.cursor = 'default'
      domProps['aria-disabled'] = true
    }

    return React.createElement(tag, {ref, style: cssStyle, ...domProps}, children)
  })
}

const MockView = createMockComponent('div')
const MockText = createMockComponent('span')
const MockScrollView = createMockComponent('div')
const MockImage = createMockComponent('img')
const MockInput = createMockComponent('input')

// -- StyleSheet --
export const StyleSheet = {
  create: (styles) => styles,
  absoluteFill: {position: 'absolute', top: 0, left: 0, right: 0, bottom: 0},
  absoluteFillObject: {position: 'absolute', top: 0, left: 0, right: 0, bottom: 0},
  hairlineWidth: 0.5,
  flatten: (style) => {
    if (Array.isArray(style)) {
      return Object.assign({}, ...style.filter(Boolean))
    }
    return style
  },
}

// -- Animated --
class AnimatedValue {
  constructor(val) {
    this._value = val
  }
  setValue(v) {
    this._value = v
  }
  interpolate = ({inputRange = [0, 1], outputRange = [0, 1]} = {}) => {
    const inputStart = inputRange[0]
    const inputEnd = inputRange[inputRange.length - 1]
    const outputStart = outputRange[0]
    const outputEnd = outputRange[outputRange.length - 1]
    const denominator = inputEnd - inputStart || 1
    const ratio = Math.max(0, Math.min(1, (this._value - inputStart) / denominator))

    if (typeof outputStart === 'number' && typeof outputEnd === 'number') {
      return outputStart + (outputEnd - outputStart) * ratio
    }

    return ratio >= 1 ? outputEnd : outputStart
  }
}

const animFactory = (value, config = {}) => ({
  start: (cb) => {
    if (value && typeof value.setValue === 'function' && 'toValue' in config) {
      value.setValue(config.toValue)
    }
    cb && cb({finished: true})
  },
  stop: noop,
})

export const Animated = {
  Value: AnimatedValue,
  View: MockView,
  Text: MockText,
  ScrollView: MockScrollView,
  Image: MockImage,
  timing: animFactory,
  spring: animFactory,
  parallel: animFactory,
  sequence: animFactory,
  loop: animFactory,
  event: () => noop,
  createAnimatedComponent: (C) => C,
}

// -- Easing --
export const Easing = {
  bezier: () => 'cubic-bezier',
  out: (v) => v,
  in: (v) => v,
  inOut: (v) => v,
  linear: 'linear',
  ease: 'ease',
}

// -- Platform --
export const Platform = {OS: 'web', select: (c) => c.web ?? c.default}

// -- Dimensions --
export const Dimensions = {
  get: () => ({width: window.innerWidth || 393, height: window.innerHeight || 852, scale: 1, fontScale: 1}),
  addEventListener: () => ({remove: noop}),
  removeEventListener: noop,
}

export const useWindowDimensions = Dimensions.get

// -- StatusBar --
export const StatusBar = Object.assign(() => null, {currentHeight: 0})

// -- DeviceEventEmitter --
export const DeviceEventEmitter = {
  addListener: () => ({remove: noop}),
  removeListener: noop,
  removeAllListeners: noop,
  emit: noop,
}

// -- PanResponder --
export const PanResponder = {
  create: () => ({panHandlers: {}}),
}

// -- NativeModules --
export const NativeModules = {}

// -- NativeEventEmitter --
export class NativeEventEmitter {
  constructor() {}
  addListener = () => ({remove: noop})
  removeAllListeners = noop
  removeSubscription = noop
}

// -- Common components --
export const View = MockView
export const Text = MockText
export const ScrollView = MockScrollView
export const Image = MockImage
export const Pressable = MockView
export const TouchableOpacity = MockView
export const TouchableWithoutFeedback = MockView
export const TextInput = MockInput
export const FlatList = MockView
export const SectionList = MockView
export const ActivityIndicator = MockView
export const Modal = MockView
export const Switch = MockView
export const Linking = {open: noop, canOpenURL: () => Promise.resolve(false)}

// -- batched updates --
export const unstable_batchedUpdates = (fn) => fn()

// -- react-dom methods (Taro runtime merges these from react-native into react-dom) --
export const findDOMNode = () => null
export const render = () => {}

export default {
  StyleSheet,
  Animated,
  Easing,
  Platform,
  Dimensions,
  useWindowDimensions,
  StatusBar,
  DeviceEventEmitter,
  PanResponder,
  NativeModules,
  NativeEventEmitter,
  View,
  Text,
  ScrollView,
  Image,
  Pressable,
  TouchableOpacity,
  TouchableWithoutFeedback,
  TextInput,
  FlatList,
  SectionList,
  ActivityIndicator,
  Modal,
  Switch,
  Linking,
  unstable_batchedUpdates,
  findDOMNode,
  render,
}
