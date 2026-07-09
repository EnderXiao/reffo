import {PropsWithChildren, ReactNode} from 'react'
import {Text, View} from '@tarojs/components'
import Taro from '@tarojs/taro'
import {StatusBar, StyleProp, StyleSheet, ViewStyle} from 'react-native'
import {getStatusBarHeight} from '@/utils'
import {navigation} from '@/utils/navigation'

interface AppPageShellProps extends PropsWithChildren {
  title?: string
  showBack?: boolean
  onBack?: () => void
  rightSlot?: ReactNode
  backgroundColor?: string
  navBackgroundColor?: string
  navHidden?: boolean
  navBorder?: boolean
  bodyStyle?: StyleProp<ViewStyle>
  statusBarInset?: 'auto' | 'none'
  statusBarTranslucent?: boolean
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
  },
  navBar: {
    minHeight: 54,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
  },
  navBorder: {
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  side: {
    width: 64,
    justifyContent: 'center',
  },
  sideRight: {
    width: 64,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  sidePlaceholder: {
    width: 28,
    height: 28,
  },
  titleWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  title: {
    color: '#111827',
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '700',
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#dbe4ee',
  },
  backIcon: {
    color: '#111827',
    fontSize: 20,
    lineHeight: 20,
    fontWeight: '700',
  },
  body: {
    flex: 1,
  },
})
export default function AppPageShell({
  title,
  showBack = false,
  onBack,
  rightSlot,
  backgroundColor = '#ffffff',
  navBackgroundColor,
  navHidden = false,
  navBorder = false,
  bodyStyle,
  statusBarInset = 'auto',
  statusBarTranslucent = false,
  children,
}: AppPageShellProps) {
  const resolvedNavBackground = navBackgroundColor ?? backgroundColor
  const statusBarHeight = getStatusBarHeight()
  const shouldRenderStatusBarInset = statusBarInset !== 'none'

  const handleBack = () => {
    if (onBack) {
      onBack()
      return
    }

    if (Taro.getCurrentPages().length > 1) {
      void navigation.navigateBack()
      return
    }

    void navigation.reLaunch('/pages/index/index')
  }

  return (
    <View style={[styles.page, {backgroundColor}] as any}>
      <StatusBar
        barStyle='dark-content'
        backgroundColor={statusBarTranslucent ? 'transparent' : resolvedNavBackground}
        translucent={statusBarTranslucent}
      />
      {shouldRenderStatusBarInset ? (
        <View style={{height: statusBarHeight, backgroundColor: resolvedNavBackground} as any} />
      ) : null}
      {!navHidden && (
        <View
          style={[
            styles.navBar,
            navBorder ? styles.navBorder : null,
            {backgroundColor: resolvedNavBackground},
          ] as any}
        >
          <View style={styles.side as any}>
            {showBack ? (
              <View style={styles.backButton as any} onClick={handleBack}>
                <Text style={styles.backIcon as any}>←</Text>
              </View>
            ) : null}
          </View>
          <View style={styles.titleWrap as any}>
            {title ? <Text style={styles.title as any}>{title}</Text> : null}
          </View>
          <View style={styles.sideRight as any}>
            {rightSlot ?? <View style={styles.sidePlaceholder as any} />}
          </View>
        </View>
      )}
      <View style={styles.body as any}>
        {bodyStyle ? <View style={bodyStyle as any}>{children}</View> : children}
      </View>
    </View>
  )
}
