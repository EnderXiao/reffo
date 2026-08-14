import {View} from '@tarojs/components'
import {styles} from './JobDescriptionStep.styles'
import {PencilGlyph} from './JobDescriptionStepGlyphs'
import type {JobDescriptionInputMode} from '../types'

export default function JobDescriptionModeTab({
  mode,
  active,
  onClick,
  testId,
  compact = false,
  disabled = false,
}: {
  mode: JobDescriptionInputMode
  active: boolean
  onClick: () => void
  testId: string
  compact?: boolean
  disabled?: boolean
}) {
  return (
    <View
      style={
        active
          ? {
              ...styles.modeTab,
              ...(compact ? styles.modeTabCompact : {}),
              ...styles.modeTabActive,
              ...(disabled ? styles.modeTabDisabled : {}),
            }
          : {
              ...styles.modeTab,
              ...(compact ? styles.modeTabCompact : {}),
              ...(disabled ? styles.modeTabDisabled : {}),
            }
      }
      onClick={disabled ? undefined : onClick}
      role='button'
      data-testid={testId}
    >
      {mode === 'upload' ? (
        <View style={styles.modeTabUploadIcon}>
          <View
            style={[
              styles.modeTabUploadIconFrame,
              active ? styles.modeTabUploadIconFrameActive : null,
            ] as any}
          >
            <View
              style={[
                styles.modeTabUploadIconStem,
                active ? styles.modeTabUploadIconStemActive : null,
              ] as any}
            />
            <View
              style={[
                styles.modeTabUploadIconArrow,
                active ? styles.modeTabUploadIconArrowActive : null,
              ] as any}
            />
          </View>
        </View>
      ) : <PencilGlyph active={active} />}
    </View>
  )
}
