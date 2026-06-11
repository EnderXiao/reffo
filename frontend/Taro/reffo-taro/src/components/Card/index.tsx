import { View } from '@tarojs/components'
import { ReactNode } from 'react'
import classNames from 'classnames'
import styles from './index.module.scss'

export interface CardProps {
  children: ReactNode
  hoverable?: boolean
  bordered?: boolean
  shadow?: 'none' | 'sm' | 'md' | 'lg' | 'xl'
  onClick?: () => void
  className?: string
  style?: React.CSSProperties
}

export function Card({
  children,
  hoverable = false,
  bordered = true,
  shadow = 'md',
  onClick,
  className,
  style
}: CardProps) {
  const cardClass = classNames(
    styles.card,
    {
      [styles['card--hoverable']]: hoverable,
      [styles['card--bordered']]: bordered,
      [styles[`card--shadow-${shadow}`]]: shadow !== 'none'
    },
    className
  )

  return (
    <View className={cardClass} onClick={onClick} style={style}>
      {children}
    </View>
  )
}
