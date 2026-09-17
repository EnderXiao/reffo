import {Component, type PropsWithChildren} from 'react'
import Taro from '@tarojs/taro'
import {initializeNavigationTransitions} from '@/utils/navigation-transition'
import {useHistoryStore} from '@/store/historyStore'
import {useSourceResumeStore} from '@/store/sourceResumeStore'
import {storage} from '@/utils/storage'
import {routePaths} from '@/shared/routing'

import './app.scss'

const LANDING_SEEN_STORAGE_KEY = 'reffo.landing.seen'

async function guardLandingEntry() {
  const pages = Taro.getCurrentPages()
  if (pages.length === 0) return
  const route = pages[pages.length - 1]?.route || ''
  if (route === routePaths.landing.slice(1)) return

  const seen = await storage.getItem(LANDING_SEEN_STORAGE_KEY)
  if (seen !== '1') await Taro.reLaunch({url: routePaths.landing})
}

class App extends Component<PropsWithChildren> {
  private loadLocalData = async () => {
    await Promise.all([
      useHistoryStore.getState().loadHistories({force: true}),
      useSourceResumeStore.getState().loadLatestSourceResume({force: true}),
    ])
  }

  componentDidMount() {
    initializeNavigationTransitions()
    void guardLandingEntry()
    void this.loadLocalData()
  }

  componentDidShow() {
    initializeNavigationTransitions()
  }

  render() {
    return this.props.children
  }
}

export default App
