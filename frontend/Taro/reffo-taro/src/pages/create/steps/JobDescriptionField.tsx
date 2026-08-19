import {Input, Text, View} from '@tarojs/components'
import {styles} from './JobDescriptionStep.styles'
import {readInputValue} from './JobDescriptionStep.utils'

export default function JobDescriptionField({
  label,
  placeholder,
  value,
  onChange,
  testId,
  compact = false,
  disabled = false,
  containerStyle,
}: {
  label: string
  placeholder: string
  value: string
  onChange: (value: string) => void
  testId: string
  compact?: boolean
  disabled?: boolean
  containerStyle?: any
}) {
  return (
    <View style={[styles.fieldBlock, compact ? styles.fieldBlockCompact : null, containerStyle] as any}>
      <Text style={[styles.fieldLabel, compact ? styles.fieldLabelCompact : null] as any}>
        {label}
      </Text>
      <View
        style={[
          styles.inputShell,
          compact ? styles.inputShellCompact : null,
          disabled ? styles.inputShellDisabled : null,
        ] as any}
      >
        <Input
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          onInput={event => {
            if (!disabled) {
              onChange(readInputValue(event))
            }
          }}
          style={[
            styles.input,
            compact ? styles.inputCompact : null,
            disabled ? styles.inputDisabled : null,
          ] as any}
          data-testid={testId}
        />
      </View>
    </View>
  )
}
