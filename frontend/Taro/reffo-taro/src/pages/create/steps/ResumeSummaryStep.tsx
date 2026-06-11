import {Text, View} from '@tarojs/components'
import {StyleSheet} from 'react-native'
import type {ResumeSummaryStepState} from '../types'

interface ResumeSummaryStepProps {
  state: ResumeSummaryStepState
}

function FileBadge() {
  return (
    <View style={styles.fileBadge}>
      <Text style={styles.fileBadgeIcon}>⌁</Text>
    </View>
  )
}

export default function ResumeSummaryStep({state}: ResumeSummaryStepProps) {
  return (
    <View style={styles.step}>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>源简历文件</Text>

        <View style={styles.fileCard} data-testid='resume-summary-card'>
          <FileBadge />
          <View style={styles.fileMeta}>
            <Text style={styles.fileName}>{state.fileName}</Text>
            <Text style={styles.fileInfo}>
              {state.sizeLabel || state.sourceTypeLabel}
            </Text>
          </View>
        </View>

        <View style={styles.timestampRow}>
          <Text style={styles.timestampText}>上传时间 {state.updatedAtLabel}</Text>
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  step: {
    paddingBottom: 20,
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    color: '#171717',
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '700',
    marginBottom: 16,
  },
  fileCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#d9e2f0',
    backgroundColor: 'rgba(244, 249, 255, 0.9)',
    minHeight: 72,
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#b6c4d8',
    shadowOffset: {width: 0, height: 8},
    shadowOpacity: 0.12,
    shadowRadius: 18,
    elevation: 2,
  },
  fileBadge: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: '#1683ff',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  fileBadgeIcon: {
    color: '#ffffff',
    fontSize: 18,
    lineHeight: 18,
    fontWeight: '700',
  },
  fileMeta: {
    flex: 1,
  },
  fileName: {
    color: '#5f7397',
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '500',
  },
  fileInfo: {
    marginTop: 2,
    color: '#7f8fa8',
    fontSize: 14,
    lineHeight: 20,
  },
  timestampRow: {
    marginTop: 8,
    alignItems: 'flex-end',
  },
  timestampText: {
    color: '#c2c6d0',
    fontSize: 12,
    lineHeight: 18,
  },
})
