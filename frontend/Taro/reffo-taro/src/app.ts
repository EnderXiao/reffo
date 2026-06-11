import { Component, PropsWithChildren, createElement } from 'react'
import { DeviceEventEmitter, StyleSheet } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'

import './app.scss'

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

  componentDidMount () {}

  componentDidShow () {}

  componentDidHide () {}

  // this.props.children 是将要会渲染的页面
  render () {
    return createElement(GestureHandlerRootView, { style: styles.root }, this.props.children)
  }
}
export default App
