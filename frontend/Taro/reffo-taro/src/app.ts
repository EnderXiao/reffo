import {Component, type PropsWithChildren} from 'react'
import Taro from '@tarojs/taro'
import {initializeNavigationTransitions} from '@/utils/navigation-transition'
import {useAuthStore} from '@/store/authStore'
import {useHistoryStore} from '@/store/historyStore'
import {useSourceResumeStore} from '@/store/sourceResumeStore'
import {storage} from '@/utils/storage'
import {syncPendingLandingData} from '@/utils/pending-landing-data'

import './app.scss'

const LANDING_SEEN_STORAGE_KEY = 'reffo.landing.seen'

async function guardLandingEntry() {
  const pages = Taro.getCurrentPages()
  if (pages.length === 0) return
  const route = pages[pages.length - 1]?.route || ''
  if (route === 'pages/landing/index') return

  const seen = await storage.getItem(LANDING_SEEN_STORAGE_KEY)
  if (seen !== '1') await Taro.reLaunch({url: '/pages/landing/index'})
}

class App extends Component<PropsWithChildren> {
  private unsubscribeAuth?: () => void
  private authenticatedDataUserId?: string

  private loadAuthenticatedData = async () => {
    const userId = useAuthStore.getState().session?.user.id
    if (!userId || this.authenticatedDataUserId === userId) return
    this.authenticatedDataUserId = userId

    try {
      await syncPendingLandingData()
    } catch (error) {
      console.error('[App] 同步 Landing 本地数据失败:', error)
    }

    await Promise.all([
      useHistoryStore.getState().loadHistories({force: true}),
      useSourceResumeStore.getState().loadLatestSourceResume({force: true}),
      useAuthStore.getState().loadProfile(),
    ])
  }

  componentDidMount() {
    initializeNavigationTransitions()
    void guardLandingEntry()
    void useAuthStore.getState().restoreSession().then(session => {
      if (session) void this.loadAuthenticatedData()
    })
    this.unsubscribeAuth = useAuthStore.subscribe((state, previous) => {
      if (state.session?.user.id && state.session.user.id !== previous.session?.user.id) {
        void this.loadAuthenticatedData()
      } else if (!state.session && previous.session) {
        this.authenticatedDataUserId = undefined
      }
    })
  }

  componentDidShow() {
    initializeNavigationTransitions()
  }

  componentWillUnmount() {
    this.unsubscribeAuth?.()
  }

  render() {
    return this.props.children
  }
}

export default App
