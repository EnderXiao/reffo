import type { UserConfigExport } from '@tarojs/cli'

type ReffoEnv = 'local' | 'nonprod' | 'prod'

function getReffoEnv(): ReffoEnv {
  const env = process.env.REFFO_ENV?.trim().toLowerCase()

  if (env === 'nonprod' || env === 'prod') {
    return env
  }

  return 'local'
}

function getApiProxyTarget(): string {
  const configuredTarget = process.env.API_PROXY_TARGET?.trim()
  if (configuredTarget) {
    return configuredTarget
  }

  const env = getReffoEnv()

  if (env === 'nonprod') {
    return 'https://api-nonprod.reffo.app'
  }

  if (env === 'prod') {
    return 'https://api.reffo.app'
  }

  return 'http://127.0.0.1:3000'
}

export default {
   logger: {
    quiet: false,
    stats: true
  },
  mini: {},
  h5: {
    devServer: {
      client: {
        overlay: false,
      },
      // SSE（/generation-jobs/events）会被压缩中间件缓冲，导致长连接拿不到首字节而反复重连。
      compress: false,
      proxy: {
        '/api': {
          target: getApiProxyTarget(),
          changeOrigin: true,
          timeout: 180000,
          proxyTimeout: 180000,
          // 关闭代理侧缓冲，保证 text/event-stream 立即透传。
          headers: {
            'X-Accel-Buffering': 'no',
          },
          onProxyRes: (proxyRes: {headers: Record<string, string | string[] | undefined>}) => {
            if (String(proxyRes.headers['content-type'] ?? '').includes('text/event-stream')) {
              delete proxyRes.headers['content-length']
              proxyRes.headers['cache-control'] = 'no-cache, no-transform'
            }
          },
        },
      },
    },
  },
} satisfies UserConfigExport<'webpack5'>
