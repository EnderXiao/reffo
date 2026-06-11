import {ScrollView, Text, View} from '@tarojs/components'
import {StyleSheet} from 'react-native'
import type {
  MatchingResult,
  OptimizedResume,
  ResumeAnalysis,
} from '@/types'

interface ResultDisplayProps {
  analysis: ResumeAnalysis
  matching: MatchingResult
  optimized: OptimizedResume
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 16,
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: '#dbe4ee',
    marginBottom: 14,
  },
  cardTitle: {
    color: '#111827',
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '700',
    marginBottom: 14,
  },
  scoreSection: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  scoreCircle: {
    width: 92,
    height: 92,
    borderRadius: 46,
    backgroundColor: '#eff6ff',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  scoreValue: {
    color: '#2563eb',
    fontSize: 32,
    lineHeight: 36,
    fontWeight: '700',
  },
  scoreLabel: {
    color: '#2563eb',
    fontSize: 13,
    marginTop: 2,
  },
  scoreDetails: {
    flex: 1,
  },
  scoreItem: {
    backgroundColor: '#f8fafc',
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 10,
  },
  scoreItemLabel: {
    color: '#6b7280',
    fontSize: 13,
    marginBottom: 4,
  },
  scoreItemValue: {
    color: '#111827',
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '700',
  },
  sectionTitle: {
    color: '#111827',
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '700',
    marginBottom: 10,
  },
  sectionBlock: {
    marginBottom: 14,
  },
  itemCard: {
    borderRadius: 14,
    backgroundColor: '#f8fafc',
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  itemText: {
    color: '#374151',
    fontSize: 14,
    lineHeight: 22,
  },
  suggestionRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  suggestionNumber: {
    width: 22,
    height: 22,
    borderRadius: 11,
    textAlign: 'center',
    lineHeight: 22,
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
    backgroundColor: '#2563eb',
    marginRight: 10,
  },
  suggestionText: {
    flex: 1,
    color: '#374151',
    fontSize: 14,
    lineHeight: 22,
  },
  resumeContent: {
    borderRadius: 14,
    backgroundColor: '#f8fafc',
    padding: 14,
  },
  resumeText: {
    color: '#1f2937',
    fontSize: 14,
    lineHeight: 22,
  },
  changeRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  changeBullet: {
    color: '#2563eb',
    fontSize: 14,
    lineHeight: 22,
    marginRight: 8,
  },
  changeText: {
    flex: 1,
    color: '#374151',
    fontSize: 14,
    lineHeight: 22,
  },
  emptyText: {
    color: '#6b7280',
    fontSize: 14,
    lineHeight: 22,
  },
})

function renderItems(items: string[]) {
  if (items.length === 0) {
    return <Text style={styles.emptyText}>暂无内容</Text>
  }

  return items.map((item, index) => (
    <View key={`${item}-${index}`} style={styles.itemCard}>
      <Text style={styles.itemText}>{item}</Text>
    </View>
  ))
}

export function ResultDisplay({
  analysis,
  matching,
  optimized,
}: ResultDisplayProps) {
  return (
    <ScrollView scrollY style={styles.container}>
      <View style={styles.content}>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>质量评分</Text>
          <View style={styles.scoreSection}>
            <View style={styles.scoreCircle}>
              <Text style={styles.scoreValue}>{analysis.quality_score}</Text>
              <Text style={styles.scoreLabel}>分</Text>
            </View>
            <View style={styles.scoreDetails}>
              <View style={styles.scoreItem}>
                <Text style={styles.scoreItemLabel}>匹配度</Text>
                <Text style={styles.scoreItemValue}>{matching.match_score}%</Text>
              </View>
              <View style={styles.scoreItem}>
                <Text style={styles.scoreItemLabel}>提升空间</Text>
                <Text style={styles.scoreItemValue}>+{optimized.improvement_score} 分</Text>
              </View>
            </View>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>分析结果</Text>
          <View style={styles.sectionBlock}>
            <Text style={styles.sectionTitle}>✓ 优势</Text>
            {renderItems(analysis.strengths)}
          </View>
          <View style={styles.sectionBlock}>
            <Text style={styles.sectionTitle}>! 待改进</Text>
            {renderItems(analysis.weaknesses)}
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>优化建议</Text>
          {matching.optimization_suggestions.length === 0 ? (
            <Text style={styles.emptyText}>暂无优化建议</Text>
          ) : (
            matching.optimization_suggestions.map((suggestion, index) => (
              <View key={`${suggestion}-${index}`} style={styles.suggestionRow}>
                <Text style={styles.suggestionNumber}>{index + 1}</Text>
                <Text style={styles.suggestionText}>{suggestion}</Text>
              </View>
            ))
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>优化后的简历</Text>
          <View style={styles.resumeContent}>
            <Text style={styles.resumeText}>{optimized.optimized_resume}</Text>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>主要变更</Text>
          {optimized.changes_summary.length === 0 ? (
            <Text style={styles.emptyText}>暂无主要变更</Text>
          ) : (
            optimized.changes_summary.map((change, index) => (
              <View key={`${change}-${index}`} style={styles.changeRow}>
                <Text style={styles.changeBullet}>•</Text>
                <Text style={styles.changeText}>{change}</Text>
              </View>
            ))
          )}
        </View>
      </View>
    </ScrollView>
  )
}
