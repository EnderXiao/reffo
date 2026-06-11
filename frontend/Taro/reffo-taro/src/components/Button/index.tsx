import {ReactNode} from 'react'
import {Text, View} from '@tarojs/components'
import {StyleSheet} from 'react-native'

export interface ButtonProps {
  type?: 'primary' | 'secondary' | 'text'
  size?: 'small' | 'medium' | 'large'
  disabled?: boolean
  loading?: boolean
  block?: boolean
  icon?: ReactNode
  onClick?: () => void
  children: ReactNode
  className?: string
}

const baseStyles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  block: {
    width: '100%',
  },
  disabled: {
    opacity: 0.5,
  },
  small: {
    minHeight: 34,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  medium: {
    minHeight: 44,
    paddingVertical: 10,
    paddingHorizontal: 18,
  },
  large: {
    minHeight: 54,
    paddingVertical: 14,
    paddingHorizontal: 22,
  },
  primary: {
    backgroundColor: '#2563eb',
  },
  secondary: {
    backgroundColor: '#ffffff',
    borderColor: '#dbe4ee',
  },
  textButton: {
    backgroundColor: 'transparent',
  },
  icon: {
    marginRight: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loading: {
    marginRight: 8,
  },
  content: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    textAlign: 'center',
    fontWeight: '600',
  },
  textSmall: {
    fontSize: 14,
    lineHeight: 18,
  },
  textMedium: {
    fontSize: 16,
    lineHeight: 20,
  },
  textLarge: {
    fontSize: 18,
    lineHeight: 24,
  },
  textPrimary: {
    color: '#ffffff',
  },
  textSecondary: {
    color: '#1f2937',
  },
  textLink: {
    color: '#2563eb',
  },
})

const containerStyleByType = {
  primary: baseStyles.primary,
  secondary: baseStyles.secondary,
  text: baseStyles.textButton,
} as const

const textStyleByType = {
  primary: baseStyles.textPrimary,
  secondary: baseStyles.textSecondary,
  text: baseStyles.textLink,
} as const

const containerStyleBySize = {
  small: baseStyles.small,
  medium: baseStyles.medium,
  large: baseStyles.large,
} as const

const textStyleBySize = {
  small: baseStyles.textSmall,
  medium: baseStyles.textMedium,
  large: baseStyles.textLarge,
} as const

export function Button({
  type = 'primary',
  size = 'medium',
  disabled = false,
  loading = false,
  block = false,
  icon,
  onClick,
  children,
}: ButtonProps) {
  const handleClick = () => {
    if (disabled || loading) return
    onClick?.()
  }

  const content =
    typeof children === 'string' || typeof children === 'number' ? (
      <Text style={[baseStyles.text, textStyleByType[type], textStyleBySize[size]] as any}>
        {children}
      </Text>
    ) : (
      children
    )

  return (
    <View
      onClick={handleClick}
      style={[
        baseStyles.button,
        containerStyleByType[type],
        containerStyleBySize[size],
        block && baseStyles.block,
        disabled && baseStyles.disabled,
      ] as any}
    >
      {loading && (
        <View style={baseStyles.loading}>
          <Text style={[baseStyles.text, textStyleByType[type], textStyleBySize[size]] as any}>
            ...
          </Text>
        </View>
      )}
      {icon && <View style={baseStyles.icon}>{icon}</View>}
      <View style={baseStyles.content}>
        {content}
      </View>
    </View>
  )
}
