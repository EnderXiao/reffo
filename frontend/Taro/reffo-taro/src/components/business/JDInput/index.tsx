import {useEffect, useState} from 'react'
import {Text, Textarea, View} from '@tarojs/components'
import {StyleSheet} from 'react-native'
import {Button} from '@/components/Button'

export interface JDInputProps {
  value?: string
  onChange: (value: string) => void
  placeholder?: string
  maxLength?: number
  className?: string
}

const styles = StyleSheet.create({
  wrapper: {
    backgroundColor: '#ffffff',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#dbe4ee',
    padding: 14,
  },
  textareaWrap: {
    minHeight: 180,
    borderRadius: 14,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  textarea: {
    minHeight: 160,
    fontSize: 15,
    lineHeight: 22,
    color: '#111827',
    textAlignVertical: 'top',
  },
  toolbar: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  charCount: {
    color: '#6b7280',
    fontSize: 12,
  },
  charCountWarn: {
    color: '#d97706',
  },
  charCountError: {
    color: '#dc2626',
  },
  warning: {
    marginTop: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 12,
    backgroundColor: '#fff7ed',
  },
  warningText: {
    color: '#d97706',
    fontSize: 13,
    lineHeight: 18,
  },
  hint: {
    marginTop: 10,
  },
  hintText: {
    color: '#6b7280',
    fontSize: 12,
    lineHeight: 18,
  },
})

export function JDInput({
  value = '',
  onChange,
  placeholder = '请输入或粘贴 JD 内容...',
  maxLength = 10000,
}: JDInputProps) {
  const [content, setContent] = useState(value)

  useEffect(() => {
    setContent(value)
  }, [value])

  const handleTextChange = (event: any) => {
    const nextValue = event.detail.value
    setContent(nextValue)
    onChange(nextValue)
  }

  const handleClear = () => {
    setContent('')
    onChange('')
  }

  const count = content.length
  const percentage = maxLength ? (count / maxLength) * 100 : 0
  const isNearLimit = percentage > 80
  const isOverLimit = count > maxLength

  return (
    <View style={styles.wrapper}>
      <View style={styles.textareaWrap}>
        <Textarea
          value={content}
          placeholder={placeholder}
          maxlength={maxLength}
          autoHeight
          onInput={handleTextChange}
          style={styles.textarea}
        />
      </View>

      <View style={styles.toolbar}>
        <Text
          style={[
            styles.charCount,
            isNearLimit && styles.charCountWarn,
            isOverLimit && styles.charCountError,
          ] as any}
        >
          {count}
          {maxLength ? ` / ${maxLength}` : ''}
        </Text>

        {!!content && (
          <Button type='text' size='small' onClick={handleClear}>
            清空
          </Button>
        )}
      </View>

      {isOverLimit && (
        <View style={styles.warning}>
          <Text style={styles.warningText}>⚠️ 内容已超出字数限制</Text>
        </View>
      )}

      <View style={styles.hint}>
        <Text style={styles.hintText}>
          💡 建议包含：岗位职责、任职要求、优先条件等关键信息
        </Text>
      </View>
    </View>
  )
}
