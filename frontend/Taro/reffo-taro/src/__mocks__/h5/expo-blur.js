/* eslint-disable */
/**
 * H5 mock for expo-blur
 *
 * In H5, falls back to a simple semi-transparent background.
 */
import React from 'react'

export const BlurView = ({children, intensity, ...props}) =>
  React.createElement('div', {style: {backdropFilter: `blur(${intensity || 10}px)`}, ...props}, children)

export const VibrancyView = BlurView

export default {BlurView, VibrancyView}
