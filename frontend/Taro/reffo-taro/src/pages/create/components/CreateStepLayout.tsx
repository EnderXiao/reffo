import {ScrollView, View} from '@tarojs/components'
import type {ReactNode} from 'react'
import {styles} from '../styles'

interface CreateStepLayoutProps {
  compact?: boolean
  header: ReactNode
  children: ReactNode
}

export function CreateStaticStepLayout({
  compact = false,
  header,
  children,
}: CreateStepLayoutProps) {
  return (
    <View style={[styles.staticContentArea, compact ? styles.staticContentAreaCompact : null] as any}>
      <View style={[styles.staticContentBody, compact ? styles.staticContentBodyCompact : null] as any}>
        <View style={styles.staticHeroSlot}>{header}</View>
        <View style={styles.staticStepSlot}>{children}</View>
      </View>
    </View>
  )
}

export function CreateScrollStepLayout({
  compact = false,
  header,
  children,
}: CreateStepLayoutProps) {
  return (
    <ScrollView scrollY style={[styles.scrollArea, compact ? styles.scrollAreaCompact : null] as any}>
      <View style={[styles.scrollContent, compact ? styles.scrollContentCompact : null] as any}>
        {header}
        {children}
      </View>
    </ScrollView>
  )
}
