import {
  Animated,
  Pressable,
  Text,
  View,
  type LayoutChangeEvent,
  type PanResponderInstance,
} from 'react-native'
import SvgIcon, {Defs, LinearGradient, Rect, Stop} from 'react-native-svg'
import type {HomeCardItem} from './shared'
import {CARD_HEIGHT, INDEX_ITEM_HEIGHT} from './shared'
import {styles} from './styles.native'

interface IndexRailProps {
  cards: HomeCardItem[]
  activeIndex: number
  isRailDragging: boolean
  dragLabel: string
  railIndicatorY: Animated.Value
  railBubbleY: Animated.Value
  panHandlers: PanResponderInstance['panHandlers']
  onLayout: (event: LayoutChangeEvent) => void
  onPressIndex: (index: number) => void
}

function resolveRailItemOpacity(index: number, total: number) {
  if (total <= 2) {
    return 1
  }

  const center = (total - 1) / 2
  const normalizedDistance = Math.abs(index - center) / Math.max(center, 1)
  const fadeStrength = 1 - Math.min(1, normalizedDistance ** 1.2)

  return 0.2 + fadeStrength * 0.8
}

export default function IndexRail({
  cards,
  activeIndex,
  isRailDragging,
  dragLabel,
  railIndicatorY,
  railBubbleY,
  panHandlers,
  onLayout,
  onPressIndex,
}: IndexRailProps) {
  const railHeight = cards.length * INDEX_ITEM_HEIGHT
  const railOffsetTop = Math.round(Math.max(46, (CARD_HEIGHT - railHeight) * 0.22))

  return (
    <View style={[styles.indexRailWrap, {top: railOffsetTop, height: railHeight}]} pointerEvents='box-none'>
      <SvgIcon
        width={30}
        height={railHeight}
        pointerEvents='none'
        style={styles.guideSvg}
      >
        <Defs>
          <LinearGradient id='index-rail-guide-gradient' x1='0%' y1='0%' x2='0%' y2='100%'>
            <Stop offset='0%' stopColor='#9da6b5' stopOpacity={0} />
            <Stop offset='18%' stopColor='#9da6b5' stopOpacity={0.22} />
            <Stop offset='50%' stopColor='#9da6b5' stopOpacity={0.82} />
            <Stop offset='82%' stopColor='#9da6b5' stopOpacity={0.22} />
            <Stop offset='100%' stopColor='#9da6b5' stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect x='29' y='0' width='1' height={railHeight} fill='url(#index-rail-guide-gradient)' />
      </SvgIcon>

      <Animated.View
        pointerEvents='none'
        style={[styles.indexIndicator, {transform: [{translateY: railIndicatorY}]}]}
      />

      {isRailDragging && dragLabel ? (
        <Animated.View
          pointerEvents='none'
          style={[styles.dragBubble, {transform: [{translateY: railBubbleY}]}]}
        >
          <Text style={styles.dragBubbleText}>{dragLabel}</Text>
        </Animated.View>
      ) : null}

      <View style={[styles.indexRail, {height: railHeight}]} onLayout={onLayout} {...panHandlers}>
        {cards.map((card, index) => {
          const isActive = index === activeIndex
          const itemOpacity = isActive ? 1 : resolveRailItemOpacity(index, cards.length)

          return (
            <Pressable
              key={card.id}
              hitSlop={{top: 5, bottom: 5, left: 12, right: 12}}
              onPress={() => onPressIndex(index)}
              style={styles.indexPressable}
            >
              <View style={[styles.indexItem, {opacity: itemOpacity}]}>
                <View style={[styles.indexTick, isActive ? styles.indexTickActive : null]} />
                <View style={styles.indexLabelWrap}>
                  <Text style={[styles.indexLabel, isActive ? styles.indexLabelActive : null]}>
                    {card.indexLabel}
                  </Text>
                </View>
              </View>
            </Pressable>
          )
        })}
      </View>
    </View>
  )
}
