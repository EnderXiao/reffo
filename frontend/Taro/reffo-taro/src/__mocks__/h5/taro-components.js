/* eslint-disable */
/**
 * H5 wrapper for @tarojs/components.
 *
 * The app shares many RN-style inline styles across Taro/RN/H5. Taro H5
 * components pass style through to React DOM, so arrays must be flattened first.
 */
const React = require('react')
const {manipulatePropsFunction} = require('@tarojs/components/lib/react/helper.js')
require('@tarojs/components/lib/react/react-component-lib/index.js')
const {createReactComponent} = require('@tarojs/components/lib/react/react-component-lib/createComponent.js')
const {defineCustomElement: defineView} = require('@tarojs/components/dist/components/taro-view-core.js')
const {defineCustomElement: defineText} = require('@tarojs/components/dist/components/taro-text-core.js')
const {defineCustomElement: defineImage} = require('@tarojs/components/dist/components/taro-image-core.js')
const {defineCustomElement: defineInput} = require('@tarojs/components/dist/components/taro-input-core.js')
const {defineCustomElement: defineTextarea} = require('@tarojs/components/dist/components/taro-textarea-core.js')
const {defineCustomElement: defineScrollView} = require('@tarojs/components/dist/components/taro-scroll-view-core.js')
const {toCSSStyle} = require('./react-native.js')

function normalizeProps(props) {
  if (!props || !('style' in props)) return props
  return {...props, style: toCSSStyle(props.style)}
}

function wrapComponent(Component) {
  if (!Component) return Component
  return React.forwardRef(function H5TaroComponent(props, ref) {
    return React.createElement(Component, {...normalizeProps(props), ref})
  })
}

function createComponent(tagName, defineCustomElement) {
  return createReactComponent(tagName, undefined, manipulatePropsFunction, defineCustomElement)
}

const View = createComponent('taro-view-core', defineView)
const Text = createComponent('taro-text-core', defineText)
const Image = createComponent('taro-image-core', defineImage)
const Input = createComponent('taro-input-core', defineInput)
const Textarea = createComponent('taro-textarea-core', defineTextarea)
const ScrollView = createComponent('taro-scroll-view-core', defineScrollView)

const wrapped = {
  View: wrapComponent(View),
  Text: wrapComponent(Text),
  Image: wrapComponent(Image),
  ScrollView: wrapComponent(ScrollView),
  Input: wrapComponent(Input),
  Textarea: wrapComponent(Textarea),
}

module.exports = wrapped
module.exports.default = wrapped
