/* eslint-disable */
/**
 * H5 wrapper for @tarojs/components.
 *
 * The app shares many RN-style inline styles across Taro/RN/H5. Taro H5
 * components pass style through to React DOM, so arrays must be flattened first.
 */
const React = require('react')
const Components = require('@tarojs/components/lib/react/index.js')
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

const wrapped = {
  ...Components,
  View: wrapComponent(Components.View),
  Text: wrapComponent(Components.Text),
  Image: wrapComponent(Components.Image),
  ScrollView: wrapComponent(Components.ScrollView),
  Input: wrapComponent(Components.Input),
  Textarea: wrapComponent(Components.Textarea),
}

module.exports = wrapped
module.exports.default = wrapped
