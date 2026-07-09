import {Text, View} from '@tarojs/components'
import {styles} from './ResumeUploadStep.styles'

export function UploadCardIcon() {
  return (
    <View style={styles.documentIcon}>
      <View style={styles.documentFold} />
      <Text style={styles.uploadArrow}>↑</Text>
    </View>
  )
}

export function PdfCardIcon() {
  return (
    <View style={[styles.documentIcon, styles.documentIconFilled] as any}>
      <View style={[styles.documentFold, styles.documentFoldFilled] as any} />
      <Text style={styles.documentBadge}>PDF</Text>
    </View>
  )
}

export function ErrorCardIcon() {
  return (
    <View style={styles.documentIcon}>
      <View style={styles.documentFold} />
      <View style={styles.errorBadge}>
        <Text style={styles.errorBadgeText}>!</Text>
      </View>
    </View>
  )
}
