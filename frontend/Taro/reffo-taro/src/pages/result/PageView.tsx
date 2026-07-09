import {Text, View} from '@tarojs/components'
import {Button} from '@/components'
import AppPageShell from '@/components/AppPageShell'
import {ResultDisplay} from '@/components/business'
import {styles} from './styles'
import type {ResultPageViewModel} from './usePageModel'

export default function PageView({
  result,
  loading,
  saved,
  handleSave,
  handleShare,
  handleBackHome,
}: ResultPageViewModel) {
  if (loading) {
    return (
      <AppPageShell
        title='优化结果'
        showBack
        backgroundColor='#fafafa'
        navBackgroundColor='#fafafa'
      >
        <View style={styles.loadingWrap}>
          <Text style={styles.loadingText}>加载中...</Text>
        </View>
      </AppPageShell>
    )
  }

  if (!result) {
    return (
      <AppPageShell
        title='优化结果'
        showBack
        backgroundColor='#fafafa'
        navBackgroundColor='#fafafa'
      >
        <View style={styles.loadingWrap}>
          <Text style={styles.loadingText}>未找到结果</Text>
        </View>
      </AppPageShell>
    )
  }

  return (
    <AppPageShell
      title='优化结果'
      showBack
      backgroundColor='#fafafa'
      navBackgroundColor='#fafafa'
      bodyStyle={styles.container}
    >
      <ResultDisplay
        analysis={result.analysis}
        matching={result.matching}
        optimized={result.optimized}
      />

      <View style={styles.actions}>
        {!saved && (
          <Button type='primary' size='large' block onClick={handleSave}>
            保存到历史
          </Button>
        )}
        <View style={saved ? undefined : styles.secondaryButton}>
          <Button type='secondary' size='large' block onClick={handleShare}>
            分享
          </Button>
        </View>
        <View style={styles.secondaryButton}>
          <Button type='secondary' size='large' block onClick={handleBackHome}>
            返回首页
          </Button>
        </View>
      </View>
    </AppPageShell>
  )
}
