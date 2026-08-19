import {Text, View} from '@tarojs/components'
import classNames from 'classnames'
import type {CSSProperties, ReactNode} from 'react'

import './index.scss'

export type FeedbackBubblePlacement = 'top' | 'right' | 'bottom' | 'left'
export type FeedbackBubbleArrow =
  | 'top-center'
  | 'bottom-center'
  | 'top-left'
  | 'bottom-left'
  | 'top-right'
  | 'bottom-right'

export interface FeedbackBubbleProps {
  children: ReactNode
  placement?: FeedbackBubblePlacement
  arrow?: FeedbackBubbleArrow
  width?: number
  height?: number
  offset?: number
  className?: string
}

export function FeedbackBubble({
  children,
  placement = 'bottom',
  arrow = 'top-center',
  width = 245,
  height = 72,
  offset = 18,
  className,
}: FeedbackBubbleProps) {
  return (
    <View
      className={classNames(
        'reffo-feedback-bubble',
        `reffo-feedback-bubble--${placement}`,
        `reffo-feedback-bubble--arrow-${arrow}`,
        className,
      )}
      style={{
        '--reffo-feedback-bubble-width': `${width}px`,
        '--reffo-feedback-bubble-height': `${height}px`,
        '--reffo-feedback-bubble-offset': `${offset}px`,
      } as CSSProperties}
    >
      <Text className='reffo-feedback-bubble__text'>{children}</Text>
    </View>
  )
}
