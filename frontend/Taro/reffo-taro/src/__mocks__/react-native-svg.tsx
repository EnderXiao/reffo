import React from 'react'

function createMockElement(tag: string) {
  return function MockElement({children, ...props}: Record<string, any>) {
    return React.createElement(tag, props, children)
  }
}

const SvgIcon = createMockElement('svg')

export const Circle = createMockElement('circle')
export const Defs = createMockElement('defs')
export const Ellipse = createMockElement('ellipse')
export const LinearGradient = createMockElement('linearGradient')
export const Path = createMockElement('path')
export const Rect = createMockElement('rect')
export const Stop = createMockElement('stop')
export const SvgXml = createMockElement('svg')

export default SvgIcon
