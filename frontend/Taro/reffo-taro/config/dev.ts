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
      proxy: {
        '/api': {
          target: getApiProxyTarget(),
          changeOrigin: true,
          timeout: 180000,
          proxyTimeout: 180000,
        },
      },
    },
  },
} satisfies UserConfigExport<'webpack5'>
