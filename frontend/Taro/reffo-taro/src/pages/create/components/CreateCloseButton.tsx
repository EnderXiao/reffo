import {Text, View} from '@tarojs/components'
import {styles} from '../styles'

interface CreateCloseButtonProps {
  compact?: boolean
  onClick: () => void
}

export default function CreateCloseButton({compact = false, onClick}: CreateCloseButtonProps) {
  return (
    <View style={[styles.chromeRow, compact ? styles.chromeRowCompact : null] as any}>
      <View
        style={styles.closeButton}
        onClick={onClick}
        role='button'
        data-testid='create-flow-close'
      >
        <Text style={styles.closeButtonText}>×</Text>
      </View>
    </View>
  )
}
