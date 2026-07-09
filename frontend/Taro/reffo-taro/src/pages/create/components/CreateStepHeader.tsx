import {Text, View} from '@tarojs/components'
import {styles} from '../styles'
import type {CreateStepMeta, CreateTitleTone} from '../types'

function getTitleToneStyle(tone: CreateTitleTone) {
  if (tone === 'accent') {
    return styles.titleSegmentAccent
  }

  if (tone === 'warm') {
    return styles.titleSegmentWarm
  }

  return null
}

interface CreateStepHeaderProps {
  meta: CreateStepMeta
  compact?: boolean
}

export default function CreateStepHeader({meta, compact = false}: CreateStepHeaderProps) {
  return (
    <View style={[styles.heroBlock, compact ? styles.heroBlockCompact : null] as any}>
      <View style={styles.titleRow}>
        {meta.titleSegments.map(segment => (
          <Text
            key={`${meta.id}-${segment.text}`}
            style={[
              styles.titleSegment,
              compact ? styles.titleSegmentCompact : null,
              getTitleToneStyle(segment.tone),
            ] as any}
          >
            {segment.text}
          </Text>
        ))}
      </View>
      <Text style={[styles.description, compact ? styles.descriptionCompact : null] as any}>
        {meta.description}
      </Text>
    </View>
  )
}
