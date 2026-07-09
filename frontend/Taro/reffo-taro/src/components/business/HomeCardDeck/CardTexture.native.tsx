import {Image, StyleSheet, View} from 'react-native'
import SvgIcon, {
  Defs,
  Ellipse,
  LinearGradient,
  RadialGradient,
  Rect,
  Stop,
} from 'react-native-svg'
import GlassSurface from '@/components/common/Glass'
import SnapshotBlurView from '@/components/common/GlassBlurView/SnapshotBlurView'
import type {HomeCardItem} from './shared'
import DARK_PATTERN_TOP_IMAGE from './assets/dark-pattern-top.png'
import ReffoGlyph from './ReffoGlyph.native'
import ReffoPattern from './ReffoPattern.native'
import {styles} from './styles.native'

interface HeroGlyphMark {
  left: number
  top: number
  width: number
  height: number
  opacity: number
  rotate?: string
}

const SOFT_HERO_GLYPH: HeroGlyphMark = {
  left: -161,
  top: -127,
  width: 468,
  height: 459,
  opacity: 0.15,
}

const DEFAULT_HERO_GLYPH: HeroGlyphMark = {
  left: 106,
  top: -32,
  width: 356,
  height: 349,
  opacity: 0.1,
}

function HeroGlyph({
  color,
  mark,
}: {
  color: string
  mark: HeroGlyphMark
}) {
  return (
    <View
      pointerEvents='none'
      style={[
        styles.logoMarkWrap,
        {
          left: mark.left,
          top: mark.top,
          width: mark.width,
          height: mark.height,
          opacity: mark.opacity,
          transform: mark.rotate ? [{rotate: mark.rotate}] : undefined,
        },
      ]}
    >
      <ReffoGlyph color={color} />
    </View>
  )
}

function SoftTexture({item}: {item: HomeCardItem}) {
  return (
    <View style={styles.textureLayer} pointerEvents='none'>
      <HeroGlyph color={item.primaryColor} mark={SOFT_HERO_GLYPH} />

      <SvgIcon width='100%' height='100%' style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id='card-soft-theme' x1='0%' y1='0%' x2='100%' y2='100%'>
            <Stop offset='0%' stopColor={item.primaryColor} stopOpacity={0.2} />
            <Stop offset='100%' stopColor='#FFFFFF' stopOpacity={0} />
          </LinearGradient>
          <LinearGradient id='card-soft-overlay' x1='0%' y1='0%' x2='100%' y2='100%'>
            <Stop offset='0%' stopColor='#FFFFFF' stopOpacity={0.12} />
            <Stop offset='58%' stopColor='#FFFFFF' stopOpacity={0.05} />
            <Stop offset='100%' stopColor='#FFFFFF' stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect x='0' y='0' width='100%' height='100%' fill='url(#card-soft-theme)' />
        <Rect x='0' y='0' width='100%' height='100%' fill='url(#card-soft-overlay)' />
      </SvgIcon>

      <View style={styles.lightBodyScrim} />
    </View>
  )
}

function DefaultTexture({item}: {item: HomeCardItem}) {
  return (
    <View style={styles.textureLayer} pointerEvents='none'>
      <HeroGlyph color={item.primaryColor} mark={DEFAULT_HERO_GLYPH} />

      <SvgIcon width='100%' height='100%' style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id='card-default-theme' x1='0%' y1='0%' x2='100%' y2='100%'>
            <Stop offset='0%' stopColor={item.primaryColor} stopOpacity={0.16} />
            <Stop offset='100%' stopColor='#FFFFFF' stopOpacity={0} />
          </LinearGradient>
          <LinearGradient id='card-default-overlay' x1='0%' y1='0%' x2='100%' y2='0%'>
            <Stop offset='0%' stopColor='#FFFFFF' stopOpacity={0.14} />
            <Stop offset='52%' stopColor='#FFFFFF' stopOpacity={0.08} />
            <Stop offset='100%' stopColor='#FFFFFF' stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect x='0' y='0' width='100%' height='100%' fill='url(#card-default-theme)' />
        <Rect x='0' y='0' width='100%' height='100%' fill='url(#card-default-overlay)' />
      </SvgIcon>

      <View style={styles.lightBodyScrim} />
    </View>
  )
}

function DarkTexture({item}: {item: HomeCardItem}) {
  return (
    <View style={styles.textureLayer} pointerEvents='none'>
      <View style={styles.darkPatternBand}>
        <View style={styles.darkPatternWrap}>
          <ReffoPattern fillOpacity={0.26} />
        </View>

        <View style={styles.darkPatternTopReveal}>
          <Image
            source={DARK_PATTERN_TOP_IMAGE}
            style={styles.darkPatternTopRevealPattern}
            resizeMode='cover'
          />
        </View>

        <SvgIcon width='100%' height='100%' style={StyleSheet.absoluteFill}>
          <Defs>
            <LinearGradient id='card-dark-accent' x1='0%' y1='0%' x2='100%' y2='100%'>
              <Stop offset='0%' stopColor={item.primaryColor} stopOpacity={0.016} />
              <Stop offset='52%' stopColor={item.primaryColor} stopOpacity={0.002} />
              <Stop offset='100%' stopColor={item.primaryColor} stopOpacity={0} />
            </LinearGradient>
            <LinearGradient id='card-dark-top-fade' x1='0%' y1='0%' x2='0%' y2='100%'>
              <Stop offset='0%' stopColor='#000000' stopOpacity={0} />
              <Stop offset='76%' stopColor='#000000' stopOpacity={0.04} />
              <Stop offset='100%' stopColor='#000000' stopOpacity={0.14} />
            </LinearGradient>
          </Defs>
          <Rect x='0' y='0' width='100%' height='100%' fill='url(#card-dark-accent)' />
          <Rect x='0' y='0' width='100%' height='100%' fill='url(#card-dark-top-fade)' />
        </SvgIcon>

        <SvgIcon width='100%' height='100%' style={styles.darkPatternBodyDampen}>
          <Defs>
            <LinearGradient id='card-dark-pattern-body-dampen' x1='0%' y1='0%' x2='0%' y2='100%'>
              <Stop offset='0%' stopColor='#090B10' stopOpacity={0.03} />
              <Stop offset='100%' stopColor='#06080C' stopOpacity={0.34} />
            </LinearGradient>
            <RadialGradient id='card-dark-pattern-body-dampen-left' cx='24%' cy='22%' rx='46%' ry='34%'>
              <Stop offset='0%' stopColor='#FFFFFF' stopOpacity={0.012} />
              <Stop offset='62%' stopColor='#0E1117' stopOpacity={0.006} />
              <Stop offset='100%' stopColor='#FFFFFF' stopOpacity={0} />
            </RadialGradient>
            <RadialGradient id='card-dark-pattern-body-dampen-center' cx='56%' cy='44%' rx='34%' ry='26%'>
              <Stop offset='0%' stopColor='#000000' stopOpacity={0.14} />
              <Stop offset='60%' stopColor='#11161C' stopOpacity={0.06} />
              <Stop offset='100%' stopColor='#000000' stopOpacity={0} />
            </RadialGradient>
            <RadialGradient id='card-dark-pattern-body-dampen-bottom' cx='52%' cy='84%' rx='56%' ry='34%'>
              <Stop offset='0%' stopColor='#000000' stopOpacity={0.2} />
              <Stop offset='58%' stopColor='#10141A' stopOpacity={0.08} />
              <Stop offset='100%' stopColor='#000000' stopOpacity={0} />
            </RadialGradient>
          </Defs>

          <Rect x='0' y='0' width='100%' height='100%' fill='url(#card-dark-pattern-body-dampen)' />
          <Ellipse cx='54' cy='34' rx='76' ry='42' fill='url(#card-dark-pattern-body-dampen-left)' />
          <Ellipse cx='116' cy='82' rx='64' ry='44' fill='url(#card-dark-pattern-body-dampen-center)' />
          <Ellipse cx='110' cy='164' rx='102' ry='56' fill='url(#card-dark-pattern-body-dampen-bottom)' />
        </SvgIcon>
      </View>

      <SvgIcon width='100%' height='100%' style={styles.darkContentPanelSourceMute}>
        <Defs>
          <LinearGradient id='card-dark-panel-source-base' x1='0%' y1='0%' x2='0%' y2='100%'>
            <Stop offset='0%' stopColor='#55575C' stopOpacity={0.05} />
            <Stop offset='34%' stopColor='#424449' stopOpacity={0.08} />
            <Stop offset='100%' stopColor='#23262C' stopOpacity={0.16} />
          </LinearGradient>
          <RadialGradient id='card-dark-panel-source-soft-top' cx='50%' cy='6%' rx='72%' ry='18%'>
            <Stop offset='0%' stopColor='#FFFFFF' stopOpacity={0.018} />
            <Stop offset='56%' stopColor='#D9E0E8' stopOpacity={0.006} />
            <Stop offset='100%' stopColor='#FFFFFF' stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id='card-dark-panel-source-soft-body' cx='50%' cy='56%' rx='64%' ry='48%'>
            <Stop offset='0%' stopColor='#5A5C61' stopOpacity={0.05} />
            <Stop offset='62%' stopColor='#32343A' stopOpacity={0.02} />
            <Stop offset='100%' stopColor='#000000' stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id='card-dark-panel-source-bottom-cloud' cx='50%' cy='88%' rx='72%' ry='30%'>
            <Stop offset='0%' stopColor='#1F2228' stopOpacity={0.14} />
            <Stop offset='58%' stopColor='#101319' stopOpacity={0.05} />
            <Stop offset='100%' stopColor='#000000' stopOpacity={0} />
          </RadialGradient>
        </Defs>

        <Rect x='0' y='0' width='100%' height='100%' fill='url(#card-dark-panel-source-base)' />
        <Ellipse cx='112' cy='12' rx='168' ry='32' fill='url(#card-dark-panel-source-soft-top)' />
        <Ellipse cx='112' cy='106' rx='174' ry='92' fill='url(#card-dark-panel-source-soft-body)' />
        <Ellipse cx='112' cy='174' rx='168' ry='52' fill='url(#card-dark-panel-source-bottom-cloud)' />
      </SvgIcon>

      <SnapshotBlurView
        style={styles.darkContentPanelSoftBlur}
        blurRadius={118}
        downsampleFactor={8}
        refreshToken={`${item.id}-${item.score}-${item.dateLabel}`}
      />

      <GlassSurface
        style={styles.darkContentPanel}
        preset='darkCardPanel'
      />

      <SvgIcon width='100%' height='100%' style={styles.darkContentPanelTransitionMask}>
        <Defs>
          <LinearGradient id='card-dark-panel-transition-mask' x1='0%' y1='0%' x2='0%' y2='100%'>
            <Stop offset='0%' stopColor='#FFFFFF' stopOpacity={0.012} />
            <Stop offset='24%' stopColor='#0A0C10' stopOpacity={0.046} />
            <Stop offset='100%' stopColor='#0A0C10' stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect x='0' y='0' width='100%' height='100%' fill='url(#card-dark-panel-transition-mask)' />
      </SvgIcon>

      <View style={styles.darkContentPanelTopEdge} />

      <SvgIcon width='100%' height='100%' style={styles.darkContentPanelMilkVeil}>
        <Defs>
          <LinearGradient id='card-dark-panel-milk-veil-base' x1='0%' y1='0%' x2='0%' y2='100%'>
            <Stop offset='0%' stopColor='#F7F9FC' stopOpacity={0.034} />
            <Stop offset='28%' stopColor='#F2F5F9' stopOpacity={0.056} />
            <Stop offset='68%' stopColor='#E6EBF2' stopOpacity={0.042} />
            <Stop offset='100%' stopColor='#DDE3EC' stopOpacity={0.026} />
          </LinearGradient>
          <RadialGradient id='card-dark-panel-milk-veil-left' cx='22%' cy='32%' rx='42%' ry='28%'>
            <Stop offset='0%' stopColor='#FFFFFF' stopOpacity={0.034} />
            <Stop offset='58%' stopColor='#E6EBF2' stopOpacity={0.012} />
            <Stop offset='100%' stopColor='#FFFFFF' stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id='card-dark-panel-milk-veil-center' cx='54%' cy='54%' rx='54%' ry='34%'>
            <Stop offset='0%' stopColor='#F1F4F8' stopOpacity={0.038} />
            <Stop offset='60%' stopColor='#DDE4EC' stopOpacity={0.012} />
            <Stop offset='100%' stopColor='#F1F4F8' stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id='card-dark-panel-milk-veil-right' cx='86%' cy='40%' rx='34%' ry='28%'>
            <Stop offset='0%' stopColor='#FFFFFF' stopOpacity={0.03} />
            <Stop offset='60%' stopColor='#E4EAF1' stopOpacity={0.01} />
            <Stop offset='100%' stopColor='#FFFFFF' stopOpacity={0} />
          </RadialGradient>
        </Defs>

        <Rect x='0' y='0' width='100%' height='100%' fill='url(#card-dark-panel-milk-veil-base)' />
        <Ellipse cx='72' cy='82' rx='132' ry='76' fill='url(#card-dark-panel-milk-veil-left)' />
        <Ellipse cx='118' cy='112' rx='168' ry='92' fill='url(#card-dark-panel-milk-veil-center)' />
        <Ellipse cx='188' cy='88' rx='118' ry='74' fill='url(#card-dark-panel-milk-veil-right)' />
      </SvgIcon>

      <SvgIcon width='100%' height='100%' style={styles.darkContentPanelFogOverlay}>
        <Defs>
          <LinearGradient id='card-dark-panel-fog-overlay-base' x1='0%' y1='0%' x2='0%' y2='100%'>
            <Stop offset='0%' stopColor='#585A60' stopOpacity={0.035} />
            <Stop offset='24%' stopColor='#404248' stopOpacity={0.055} />
            <Stop offset='100%' stopColor='#171A20' stopOpacity={0.12} />
          </LinearGradient>
          <LinearGradient id='card-dark-panel-fog-overlay-film' x1='0%' y1='0%' x2='0%' y2='100%'>
            <Stop offset='0%' stopColor='#FFFFFF' stopOpacity={0.014} />
            <Stop offset='20%' stopColor='#FFFFFF' stopOpacity={0.006} />
            <Stop offset='38%' stopColor='#FFFFFF' stopOpacity={0} />
            <Stop offset='100%' stopColor='#FFFFFF' stopOpacity={0} />
          </LinearGradient>
          <RadialGradient id='card-dark-panel-fog-overlay-top-bridge' cx='50%' cy='10%' rx='70%' ry='18%'>
            <Stop offset='0%' stopColor='#FFFFFF' stopOpacity={0.03} />
            <Stop offset='56%' stopColor='#D9DEE5' stopOpacity={0.012} />
            <Stop offset='100%' stopColor='#FFFFFF' stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id='card-dark-panel-fog-overlay-bottom' cx='50%' cy='82%' rx='52%' ry='30%'>
            <Stop offset='0%' stopColor='#000000' stopOpacity={0.12} />
            <Stop offset='58%' stopColor='#12161D' stopOpacity={0.05} />
            <Stop offset='100%' stopColor='#FFFFFF' stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id='card-dark-panel-fog-overlay-cloud-center' cx='50%' cy='56%' rx='66%' ry='40%'>
            <Stop offset='0%' stopColor='#25282E' stopOpacity={0.08} />
            <Stop offset='60%' stopColor='#10141A' stopOpacity={0.03} />
            <Stop offset='100%' stopColor='#10141A' stopOpacity={0} />
          </RadialGradient>
        </Defs>

        <Rect x='0' y='0' width='100%' height='100%' fill='url(#card-dark-panel-fog-overlay-base)' />
        <Rect x='0' y='0' width='100%' height='100%' fill='url(#card-dark-panel-fog-overlay-film)' />
        <Ellipse cx='112' cy='16' rx='154' ry='36' fill='url(#card-dark-panel-fog-overlay-top-bridge)' />
        <Ellipse cx='126' cy='108' rx='186' ry='102' fill='url(#card-dark-panel-fog-overlay-cloud-center)' />
        <Ellipse cx='118' cy='170' rx='150' ry='82' fill='url(#card-dark-panel-fog-overlay-bottom)' />
      </SvgIcon>

      <SvgIcon width='100%' height='100%' style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id='card-dark-panel-highlight' x1='0%' y1='0%' x2='0%' y2='100%'>
            <Stop offset='0%' stopColor='#FFFFFF' stopOpacity={0.06} />
            <Stop offset='34%' stopColor='#FFFFFF' stopOpacity={0.016} />
            <Stop offset='100%' stopColor='#FFFFFF' stopOpacity={0} />
          </LinearGradient>
          <LinearGradient id='card-dark-body-fade' x1='0%' y1='0%' x2='0%' y2='100%'>
            <Stop offset='0%' stopColor='#FFFFFF' stopOpacity={0.022} />
            <Stop offset='34%' stopColor='#FFFFFF' stopOpacity={0} />
            <Stop offset='100%' stopColor='#000000' stopOpacity={0.14} />
          </LinearGradient>
        </Defs>
        <Rect x='0' y='40%' width='100%' height='60%' fill='url(#card-dark-panel-highlight)' />
        <Rect x='0' y='0' width='100%' height='100%' fill='url(#card-dark-body-fade)' />
      </SvgIcon>
    </View>
  )
}

interface CardTextureProps {
  item: HomeCardItem
}

export default function CardTexture({item}: CardTextureProps) {
  if (item.tone === 'dark') {
    return <DarkTexture item={item} />
  }

  if (item.tone === 'soft') {
    return <SoftTexture item={item} />
  }

  return <DefaultTexture item={item} />
}
