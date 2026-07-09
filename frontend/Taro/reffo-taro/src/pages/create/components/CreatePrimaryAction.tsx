import {Text, View} from '@tarojs/components'
import {styles} from '../styles'
import type {CreateStepId} from '../types'

function getPrimaryButtonVariantStyle(stepId: CreateStepId) {
  if (stepId === 'jobDescription') {
    return styles.primaryButtonWarm
  }

  if (stepId === 'resumeSummary') {
    return styles.primaryButtonDark
  }

  return styles.primaryButtonCool
}

interface CreatePrimaryActionProps {
  stepId: CreateStepId
  label: string
  disabled: boolean
  loading: boolean
  compact?: boolean
  onClick: () => void
}

export default function CreatePrimaryAction({
  stepId,
  label,
  disabled,
  loading,
  compact = false,
  onClick,
}: CreatePrimaryActionProps) {
  const primaryButtonStyle =
    !disabled && !loading
      ? {...styles.primaryButton, ...getPrimaryButtonVariantStyle(stepId)}
      : {
          ...styles.primaryButton,
          ...getPrimaryButtonVariantStyle(stepId),
          ...styles.primaryButtonDisabled,
        }

  return (
    <View style={[styles.footer, compact ? styles.footerCompact : null] as any}>
      <View
        style={[
          primaryButtonStyle,
          compact ? styles.primaryButtonCompact : null,
        ] as any}
        onClick={onClick}
        role='button'
        {...({'aria-disabled': disabled || loading} as any)}
        data-testid='create-flow-primary-action'
      >
        <View style={styles.primaryButtonContent}>
          {stepId === 'jobDescription' ? (
            <Text style={styles.primaryButtonSparkle}>✦</Text>
          ) : null}
          <Text style={[styles.primaryButtonText, compact ? styles.primaryButtonTextCompact : null] as any}>
            {loading ? '处理中...' : label}
          </Text>
        </View>
      </View>
    </View>
  )
}
