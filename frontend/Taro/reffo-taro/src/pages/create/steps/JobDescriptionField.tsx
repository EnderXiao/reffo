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
}: {
  label: string
  placeholder: string
  value: string
  onChange: (value: string) => void
  testId: string
  compact?: boolean
}) {
  return (
    <View style={[styles.fieldBlock, compact ? styles.fieldBlockCompact : null] as any}>
      <Text style={[styles.fieldLabel, compact ? styles.fieldLabelCompact : null] as any}>
        {label}
      </Text>
      <View style={[styles.inputShell, compact ? styles.inputShellCompact : null] as any}>
        <Input
          value={value}
          placeholder={placeholder}
          onInput={event => onChange(readInputValue(event))}
          style={[styles.input, compact ? styles.inputCompact : null] as any}
          data-testid={testId}
        />
      </View>
    </View>
  )
}
