import {Text, View} from '@tarojs/components'
import {useEffect, useRef} from 'react'
import {Animated, Pressable} from 'react-native'
import SvgIcon, {Path} from 'react-native-svg'
import {HOME_PAGE_CONTENT} from '../constants/content'
import {styles} from '../styles'

interface HomeFooterProps {
  isCreateMode: boolean
  showCancelCreate: boolean
  onEnterCreateMode: () => void
  onCancelCreate: () => void
  compact?: boolean
}

function StartCreateIcon() {
  return (
    <SvgIcon width={14} height={14} viewBox='0 0 14 14' fill='none'>
      <Path
        d='M7 10.75V3.25M7 3.25L4.375 5.875M7 3.25L9.625 5.875'
        stroke='#818997'
        strokeWidth={1.6}
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    </SvgIcon>
  )
}

function CancelCreateIcon() {
  return (
    <SvgIcon width={14} height={14} viewBox='0 0 14 14' fill='none'>
      <Path
        d='M4.25 4.25L9.75 9.75M9.75 4.25L4.25 9.75'
        stroke='#121212'
        strokeWidth={1.6}
        strokeLinecap='round'
      />
    </SvgIcon>
  )
}

export default function HomeFooter({
  isCreateMode,
  showCancelCreate,
  onEnterCreateMode,
  onCancelCreate,
  compact = false,
}: HomeFooterProps) {
  const createModeProgress = useRef(new Animated.Value(isCreateMode ? 1 : 0)).current

  useEffect(() => {
    Animated.timing(createModeProgress, {
      toValue: isCreateMode ? 1 : 0,
      duration: isCreateMode ? 280 : 220,
      useNativeDriver: true,
    }).start()
  }, [createModeProgress, isCreateMode])

  const previewActionAnimatedStyle = {
    opacity: createModeProgress.interpolate({
      inputRange: [0, 1],
      outputRange: [1, 0],
      extrapolate: 'clamp',
    }),
    transform: [
      {
        translateY: createModeProgress.interpolate({
          inputRange: [0, 1],
          outputRange: [0, 8],
          extrapolate: 'clamp',
        }),
      },
      {
        scale: createModeProgress.interpolate({
          inputRange: [0, 1],
          outputRange: [1, 0.96],
          extrapolate: 'clamp',
        }),
      },
    ],
  }
  const createActionAnimatedStyle = {
    opacity: createModeProgress,
    transform: [
      {
        translateY: createModeProgress.interpolate({
          inputRange: [0, 1],
          outputRange: [10, 0],
          extrapolate: 'clamp',
        }),
      },
    ],
  }

  return (
    <View style={[styles.actionSection, compact ? styles.actionSectionCompact : null] as any}>
      <View style={styles.footerActionStage}>
        <Animated.View
          style={[styles.footerPreviewActionWrap as any, previewActionAnimatedStyle]}
          pointerEvents={isCreateMode ? 'none' : 'auto'}
        >
          <View style={[styles.ctaShadow as any, compact ? styles.ctaShadowCompact : null] as any}>
            <Pressable
              style={[styles.ctaButton as any, compact ? styles.ctaButtonCompact : null] as any}
              onPress={onEnterCreateMode}
            >
              <Text style={styles.ctaButtonIcon as any}>+</Text>
              <Text style={styles.ctaButtonText as any}>{HOME_PAGE_CONTENT.footer.createResumeLabel}</Text>
            </Pressable>
          </View>
        </Animated.View>

        <Animated.View
          style={[
            styles.footerCreateActions as any,
            compact ? styles.footerCreateActionsCompact : null,
            createActionAnimatedStyle,
          ]}
          pointerEvents={isCreateMode ? 'auto' : 'none'}
        >
          <View style={styles.footerActionGroupLeft}>
            <View style={styles.inlineActionButton}>
              <View style={styles.inlineActionIconWrap}>
                <StartCreateIcon />
              </View>
              <Text style={styles.inlineActionText as any}>{HOME_PAGE_CONTENT.footer.startCreateLabel}</Text>
            </View>
          </View>
          {showCancelCreate ? (
            <View style={styles.footerActionGroupRight}>
              <Pressable style={styles.inlineCancelButton} onPress={onCancelCreate} hitSlop={8}>
                <View style={styles.inlineCancelIconWrap}>
                  <CancelCreateIcon />
                </View>
                <Text style={styles.inlineCancelText as any}>{HOME_PAGE_CONTENT.footer.cancelCreateLabel}</Text>
              </Pressable>
            </View>
          ) : null}
        </Animated.View>
      </View>

      <Animated.View
        style={[styles.disclaimerWrap as any, previewActionAnimatedStyle]}
        pointerEvents='none'
      >
        <Text style={[styles.disclaimer, compact ? styles.disclaimerCompact : null] as any}>
          {HOME_PAGE_CONTENT.footer.disclaimer}
        </Text>
      </Animated.View>
    </View>
  )
}
