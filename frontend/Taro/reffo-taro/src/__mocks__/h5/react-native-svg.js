/* eslint-disable */
/**
 * H5 mock for react-native-svg
 *
 * Maps SVG components to native HTML SVG elements.
 */
import React from 'react'
import {toCSSStyle} from './react-native.js'

function createSvgElement(tag) {
  const Component = ({style, ...props}) => React.createElement(tag, {...props, style: toCSSStyle(style)})
  Component.displayName = tag
  return Component
}

export const Svg = createSvgElement('svg')
export const Circle = createSvgElement('circle')
export const Ellipse = createSvgElement('ellipse')
export const G = createSvgElement('g')
export const Text = createSvgElement('text')
export const TSpan = createSvgElement('tspan')
export const TextPath = createSvgElement('textPath')
export const Path = createSvgElement('path')
export const Polygon = createSvgElement('polygon')
export const Polyline = createSvgElement('polyline')
export const Line = createSvgElement('line')
export const Rect = createSvgElement('rect')
export const Use = createSvgElement('use')
export const Image = createSvgElement('image')
export const Defs = createSvgElement('defs')
export const LinearGradient = createSvgElement('linearGradient')
export const RadialGradient = createSvgElement('radialGradient')
export const Stop = createSvgElement('stop')
export const ClipPath = createSvgElement('clipPath')
export const Pattern = createSvgElement('pattern')
export const Mask = createSvgElement('mask')
export const SvgXml = Svg
export const SvgUri = Svg
export const SvgFromUri = Svg
export const SvgFromXml = Svg

export default Svg
