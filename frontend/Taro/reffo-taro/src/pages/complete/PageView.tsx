import {Text, View} from '@tarojs/components'
import AppPageShell from '@/components/AppPageShell'
import {styles} from './styles'
import type {CompletePageViewModel} from './usePageModel'

export default function PageView({loading, handleContinue}: CompletePageViewModel) {
  return (
    <AppPageShell navHidden backgroundColor='#f4fff7' statusBarInset='none'>
      <View style={styles.container} onClick={handleContinue}>
        <Text style={styles.title}>{loading ? '正在准备...' : '恭喜你！'}</Text>
        <Text style={styles.body}>新申请目标岗位的简历已经准备就绪，点击进入首页查看。</Text>
      </View>
    </AppPageShell>
  )
}
