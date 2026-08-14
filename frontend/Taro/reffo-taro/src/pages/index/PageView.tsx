import {Text, View} from '@tarojs/components'
import {useEffect, useRef} from 'react'
import {Animated, ScrollView} from 'react-native'
import AppPageShell from '@/components/AppPageShell'
import HomeCardDeck from '@/components/business/HomeCardDeck'
import {
  DEFAULT_FLOATING_TOP_OFFSET,
  DEFAULT_PAGE_BOTTOM_PADDING,
  useDeviceLayoutMetrics,
} from '@/utils'
import HomeBackdrop from './components/HomeBackdrop'
import HomeFooter from './components/HomeFooter'
import HomeHeader from './components/HomeHeader'
import HomeHero from './components/HomeHero'
import {styles} from './styles'
import type {IndexPageViewModel} from './model/usePageModel'

export default function PageView({
  cardItems,
  currentCard,
  currentProgress,
  displayTotal,
  isLoading,
  loadingError,
  hasHistories,
  hasSourceResume,
  sourceResumeTitle,
  isStrategyVisible,
  isCreateMode,
  initialCardIndex,
  handleEnterCreateMode,
  handleConfirmCreate,
  handleCancelCreate,
  handleViewHistory,
  handleCardPress,
  handleCardChange,
  handleDeckFirstInteraction,
  logoSource,
}: IndexPageViewModel) {
  const {floatingTopInset, pageBottomPadding, viewportHeight} = useDeviceLayoutMetrics()
  const createModeProgress = useRef(new Animated.Value(isCreateMode ? 1 : 0)).current
  const isCompactLayout = viewportHeight <= 820
  const shouldEnableScroll =
    viewportHeight <
    (isCompactLayout ? 752 : 790) +
      Math.max(0, floatingTopInset - DEFAULT_FLOATING_TOP_OFFSET) +
      Math.max(0, pageBottomPadding - DEFAULT_PAGE_BOTTOM_PADDING)

  useEffect(() => {
    Animated.timing(createModeProgress, {
      toValue: isCreateMode ? 1 : 0,
      duration: isCreateMode ? 280 : 220,
      useNativeDriver: true,
    }).start()
  }, [createModeProgress, isCreateMode])

  const progressBadgeAnimatedStyle = {
    opacity: createModeProgress.interpolate({
      inputRange: [0, 1],
      outputRange: [1, 0],
      extrapolate: 'clamp',
    }),
    transform: [
      {
        translateY: createModeProgress.interpolate({
          inputRange: [0, 1],
          outputRange: [0, -8],
          extrapolate: 'clamp',
        }),
      },
    ],
  }

  return (
    <AppPageShell navHidden backgroundColor='#f5f5f6' statusBarInset='none' statusBarTranslucent>
      <View style={styles.container}>
        <HomeBackdrop />
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          scrollEnabled={shouldEnableScroll}
          showsVerticalScrollIndicator={shouldEnableScroll}
          bounces={shouldEnableScroll}
        >
          <View
            style={[
              styles.contentFrame,
              {
                minHeight: viewportHeight,
                paddingTop: floatingTopInset,
                paddingBottom: pageBottomPadding,
              },
            ] as any}
          >
            <View style={styles.mainContent}>
              <HomeHeader
                onViewHistory={handleViewHistory}
                hasSourceResume={hasSourceResume}
                sourceResumeTitle={sourceResumeTitle}
              />
              <HomeHero
                currentCard={currentCard}
                isStrategyVisible={isStrategyVisible}
                isCreateMode={isCreateMode}
                logoSource={logoSource}
                compact={isCompactLayout}
              />

              <View style={[styles.feedbackSlot, isCompactLayout ? styles.feedbackSlotCompact : null] as any}>
                {isLoading && !hasHistories ? (
                  <View style={styles.loadingSection}>
                    <Text style={styles.loadingText}>加载中...</Text>
                  </View>
                ) : null}

                {loadingError && !hasHistories ? (
                  <View style={styles.errorSection}>
                    <Text style={styles.errorText}>加载失败: {loadingError}</Text>
                  </View>
                ) : null}
              </View>

              <View style={styles.deckCluster}>
                <View style={styles.deckInner}>
                  <Animated.View
                    pointerEvents='none'
                    style={[
                      styles.progressBadge as any,
                      isCompactLayout ? styles.progressBadgeCompact : null,
                      progressBadgeAnimatedStyle,
                    ]}
                  >
                    <Text style={styles.progressText}>当前简历 {currentProgress}/{displayTotal} 项</Text>
                  </Animated.View>

                  <View style={[styles.deckSection, isCompactLayout ? styles.deckSectionCompact : null] as any}>
                    <HomeCardDeck
                      cards={cardItems}
                      initialIndex={initialCardIndex}
                      isCreateMode={isCreateMode}
                      onCreateCardPress={handleConfirmCreate}
                      onCardPress={hasHistories ? handleCardPress : undefined}
                      onCardChange={handleCardChange}
                      onFirstInteraction={handleDeckFirstInteraction}
                    />
                  </View>
                </View>
              </View>
            </View>

            <HomeFooter
              isCreateMode={isCreateMode}
              showCancelCreate={hasHistories}
              onEnterCreateMode={handleEnterCreateMode}
              onCancelCreate={handleCancelCreate}
              compact={isCompactLayout}
            />
          </View>
        </ScrollView>
      </View>
    </AppPageShell>
  )
}
