import { Component, PropsWithChildren, createElement } from 'react'
import Taro from '@tarojs/taro'
import { DeviceEventEmitter, StyleSheet } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { initializeNavigationTransitions } from '@/utils/navigation-transition'
import { useAuthStore } from '@/store/authStore'
import { useHistoryStore } from '@/store/historyStore'
import { useSourceResumeStore } from '@/store/sourceResumeStore'
import { storage } from '@/utils/storage'
import { syncPendingLandingData } from '@/utils/pending-landing-data'

import './app.scss'

const LANDING_SEEN_STORAGE_KEY = 'reffo.landing.seen'

async function guardLandingEntry() {
  const pages = Taro.getCurrentPages()
  if (pages.length === 0) {
    return
  }
  const route = pages[pages.length - 1]?.route || ''
  if (route === 'pages/landing/index') {
    return
  }

  const seen = await storage.getItem(LANDING_SEEN_STORAGE_KEY)
  if (seen !== '1') {
    await Taro.reLaunch({url: '/pages/landing/index'})
  }
}

function patchDeviceEventEmitterRemoveListener() {
  const emitter = DeviceEventEmitter as typeof DeviceEventEmitter & {
    __reffoRemoveListenerPatched?: boolean
    removeListener?: (eventType: string, listener: (...args: any[]) => void) => void
  }

  if (emitter.__reffoRemoveListenerPatched || typeof emitter.addListener !== 'function') {
    return
  }

  if (typeof emitter.removeListener === 'function') {
    emitter.__reffoRemoveListenerPatched = true
    return
  }

  const originalAddListener = emitter.addListener.bind(emitter)
  const subscriptions = new Map<string, Map<(...args: any[]) => void, Array<{remove?: () => void}>>>()

  emitter.addListener = ((eventType: string, listener: (...args: any[]) => void, context?: unknown) => {
    const subscription = originalAddListener(eventType, listener, context as never) as {remove?: () => void}
    const listenersByEvent = subscriptions.get(eventType) || new Map()
    const listenerSubscriptions = listenersByEvent.get(listener) || []

    listenerSubscriptions.push(subscription)
    listenersByEvent.set(listener, listenerSubscriptions)
    subscriptions.set(eventType, listenersByEvent)

    return subscription as never
  }) as typeof emitter.addListener

  emitter.removeListener = (eventType: string, listener: (...args: any[]) => void) => {
    const listenersByEvent = subscriptions.get(eventType)
    const listenerSubscriptions = listenersByEvent?.get(listener)
    const subscription = listenerSubscriptions?.shift()

    subscription?.remove?.()

    if (!listenerSubscriptions || listenerSubscriptions.length > 0) {
      return
    }

    listenersByEvent?.delete(listener)
    if (listenersByEvent && listenersByEvent.size === 0) {
      subscriptions.delete(eventType)
    }
  }

  emitter.__reffoRemoveListenerPatched = true
}

patchDeviceEventEmitterRemoveListener()

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
})

class App extends Component<PropsWithChildren> {
  private unsubscribeAuth?: () => void
  private authenticatedDataUserId?: string

  private loadAuthenticatedData = async () => {
    const userId = useAuthStore.getState().session?.user.id
    if (!userId || this.authenticatedDataUserId === userId) {
      return
    }
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

  componentDidMount () {
    initializeNavigationTransitions()
    void guardLandingEntry()
    void useAuthStore.getState().restoreSession().then(session => {
      if (!session) {
        return
      }

      void this.loadAuthenticatedData()
    })
    this.unsubscribeAuth = useAuthStore.subscribe((state, previous) => {
      if (state.session?.user.id && state.session.user.id !== previous.session?.user.id) {
        void this.loadAuthenticatedData()
      } else if (!state.session && previous.session) {
        this.authenticatedDataUserId = undefined
      }
    })
  }

  componentDidShow () {
    initializeNavigationTransitions()
  }

  componentDidHide () {}

  componentWillUnmount () {
    this.unsubscribeAuth?.()
  }

  // this.props.children 是将要会渲染的页面
  render () {
    return createElement(GestureHandlerRootView, { style: styles.root }, this.props.children)
  }
}
export default App
