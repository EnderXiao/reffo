import {Text, View} from '@tarojs/components'
import classNames from 'classnames'

interface CreatePrimaryActionH5Props {
  label: string
  disabled?: boolean
  loading?: boolean
  onClick: () => void
}

export default function CreatePrimaryActionH5({label, disabled = false, loading = false, onClick}: CreatePrimaryActionH5Props) {
  const inactive = disabled || loading
  return (
    <View
      className={classNames('reffo-create__primary', 'reffo-create__primary--warm', {'reffo-create__primary--disabled': inactive})}
      onClick={inactive ? undefined : onClick}
      role='button'
      aria-disabled={inactive}
      data-testid='create-flow-primary-action'
    >
      <View className='reffo-create__primary-spark' aria-hidden='true'>
        <Text className='reffo-create__primary-spark-main'>✦</Text>
        <Text className='reffo-create__primary-spark-small'>✦</Text>
      </View>
      <Text>{loading ? '处理中...' : label}</Text>
    </View>
  )
}
