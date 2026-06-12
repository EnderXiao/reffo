import {View} from '@tarojs/components'
import {styles} from './JobDescriptionStep.styles'

export function DocumentGlyph({
  tone = 'muted',
  compact = false,
}: {
  tone?: 'muted' | 'accent'
  compact?: boolean
}) {
  const paperStyle = [
    styles.documentGlyph,
    tone === 'accent' ? styles.documentGlyphAccent : styles.documentGlyphMuted,
    compact ? styles.documentGlyphCompact : null,
  ] as any
  const foldStyle = [
    styles.documentGlyphFold,
    tone === 'accent' ? styles.documentGlyphFoldAccent : styles.documentGlyphFoldMuted,
    compact ? styles.documentGlyphFoldCompact : null,
  ] as any
  const lineToneStyle = tone === 'accent' ? styles.documentGlyphLineAccent : null

  return (
    <View style={paperStyle}>
      <View style={foldStyle} />
      <View style={[styles.documentGlyphLineShort, lineToneStyle] as any} />
      <View style={[styles.documentGlyphLineLong, lineToneStyle] as any} />
      <View style={[styles.documentGlyphLineShort, lineToneStyle] as any} />
    </View>
  )
}

export function PencilGlyph({active = false}: {active?: boolean}) {
  return (
    <View style={styles.pencilGlyph}>
      <View
        style={[
          styles.pencilGlyphBody,
          active ? styles.pencilGlyphBodyActive : null,
        ] as any}
      />
      <View
        style={[
          styles.pencilGlyphTip,
          active ? styles.pencilGlyphTipActive : null,
        ] as any}
      />
    </View>
  )
}
