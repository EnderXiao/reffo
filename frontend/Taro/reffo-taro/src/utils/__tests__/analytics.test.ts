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

  test('切后台立即交付未满批次且移除定时器，避免重复上报', async () => {
    const {track,initializeAnalyticsLifecycle} = loadAnalytics()
    const dispose = initializeAnalyticsLifecycle()
    try {
      track('view_landing')
      Object.defineProperty(document,'visibilityState',{value:'hidden',configurable:true})
      document.dispatchEvent(new Event('visibilitychange'))
      expect(sendBeacon).toHaveBeenCalledTimes(1)
      expect(sendBeacon.mock.calls[0][1].type).toBe('application/json')
      jest.advanceTimersByTime(6000)
      expect(sendBeacon).toHaveBeenCalledTimes(1)
    } finally { dispose(); Object.defineProperty(document,'visibilityState',{value:'visible',configurable:true}) }
  })

  test('pagehide会flush，卸载后不会残留事件订阅', () => {
    const {track,initializeAnalyticsLifecycle} = loadAnalytics()
    const dispose = initializeAnalyticsLifecycle()
    track('click_home_create')
    window.dispatchEvent(new Event('pagehide'))
    expect(sendBeacon).toHaveBeenCalledTimes(1)
    dispose()
    track('click_login_submit')
    window.dispatchEvent(new Event('pagehide'))
    expect(sendBeacon).toHaveBeenCalledTimes(1)
    jest.advanceTimersByTime(5000)
    expect(sendBeacon).toHaveBeenCalledTimes(2)
  })

  test('浏览器拒绝或抛出sendBeacon时不重试且不影响业务', () => {
    const {track} = loadAnalytics()
    sendBeacon.mockImplementation(() => { throw new Error('browser refused') })
    for (let i=0;i<9;i++) track('click_generate')
    expect(() => track('click_generate')).not.toThrow()
    jest.advanceTimersByTime(6000)
    expect(sendBeacon).toHaveBeenCalledTimes(1)
    sendBeacon.mockReturnValue(false)
    track('click_generate')
    jest.advanceTimersByTime(5000)
    expect(sendBeacon).toHaveBeenCalledTimes(2)
    jest.advanceTimersByTime(10000)
    expect(sendBeacon).toHaveBeenCalledTimes(2)
  })

  test('上报前移除凭据字段并保留可关联业务ID', async () => {
    const {track,setAnalyticsSessionId} = loadAnalytics()
    setAnalyticsSessionId('session-test')
    const props: Record<string,unknown> = {share_id:'share-123',access_token:'secret',nested:{password:'private'},error:'failed for user@example.test Bearer hidden'}
    props.cycle=props
    track('share_created',props)
    jest.advanceTimersByTime(5000)
    const body=sendBeacon.mock.calls[0][1] as Blob
    const text=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(reader.error);reader.readAsText(body)})
    const rows=JSON.parse(text)
    expect(rows[0].session_id).toBe('session-test')
    expect(rows[0].properties.share_id).toBe('share-123')
    expect(text).not.toContain('private')
    expect(text).not.toContain('user@example.test')
    expect(text).not.toContain('Bearer hidden')
    expect(rows[0].properties.access_token).toBe('[REDACTED]')
    expect(text).toContain('[TRUNCATED]')
  })

})
