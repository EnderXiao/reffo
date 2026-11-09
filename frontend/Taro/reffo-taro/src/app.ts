import {Component, type PropsWithChildren} from 'react'
import Taro from '@tarojs/taro'
import {initializeNavigationTransitions} from '@/utils/navigation-transition'
import {useAuthStore} from '@/store/authStore'
import {storage} from '@/utils/storage'
import {bootstrapHomeData, refreshHomeData} from '@/utils/home-data-bootstrap'
import {routePaths} from '@/shared/routing'

import './app.scss'

const LANDING_SEEN_STORAGE_KEY = 'reffo.landing.seen'

function isProfileMockUrl() {
  return process.env.NODE_ENV === 'development'
    && typeof window !== 'undefined'
    && window.location.href.includes('mock=1')
}

async function guardLandingEntry() {
  if (isProfileMockUrl()) return
  const pages = Taro.getCurrentPages()
  if (pages.length === 0) return
  const route = pages[pages.length - 1]?.route || ''
  if (route === routePaths.landing.slice(1)) return

  const seen = await storage.getItem(LANDING_SEEN_STORAGE_KEY)
  if (seen !== '1') await Taro.reLaunch({url: routePaths.landing})
}

class App extends Component<PropsWithChildren> {
  private unsubscribeAuth?: () => void

  componentDidMount() {
    initializeNavigationTransitions()
    void guardLandingEntry()
    if (!isProfileMockUrl()) void bootstrapHomeData()
    this.unsubscribeAuth = useAuthStore.subscribe((state, previous) => {
      const userId = state.session?.user.id
      const previousUserId = previous.session?.user.id
      if (previous.initialized && userId && userId !== previousUserId) {
        void refreshHomeData()
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
