import { track, setAnalyticsSessionId } from '../analytics'

jest.mock('@/services/api', () => ({
  apiClient: {
    getBaseURL: () => 'https://api.example.com/api/v1',
  },
}))

function loadAnalytics() {
  jest.resetModules()
  return require('../analytics') as typeof import('../analytics')
}

describe('analytics', () => {
  let sendBeacon: jest.Mock

  beforeEach(() => {
    jest.useFakeTimers()
    sendBeacon = jest.fn(() => true)
    Object.defineProperty(global, 'navigator', {
      value: { sendBeacon },
      configurable: true,
    })
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  test('攒满 10 条触发一次批量 sendBeacon', () => {
    const { track } = loadAnalytics()
    for (let i = 0; i < 10; i++) {
      track('click_generate', { index: i })
    }
    expect(sendBeacon).toHaveBeenCalledTimes(1)
    const [url, body] = sendBeacon.mock.calls[0]
    expect(url).toBe('https://api.example.com/api/v1/telemetry')
    expect(body).toBeInstanceOf(Blob)
  })

  test('未满批次时按 5 秒定时 flush', () => {
    const { track } = loadAnalytics()
    track('single_event')
    expect(sendBeacon).not.toHaveBeenCalled()
    jest.advanceTimersByTime(5000)
    expect(sendBeacon).toHaveBeenCalledTimes(1)
  })

  test('setAnalyticsSessionId 覆盖会话 ID', () => {
    const mod = loadAnalytics()
    mod.setAnalyticsSessionId('fixed-session-1')
    for (let i = 0; i < 10; i++) {
      mod.track('event_x')
    }
    expect(sendBeacon).toHaveBeenCalledTimes(1)
  })
})
