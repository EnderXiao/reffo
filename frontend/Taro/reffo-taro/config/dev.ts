import type { UserConfigExport } from "@tarojs/cli";
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
          target: 'http://127.0.0.1:3000',
          changeOrigin: true,
          timeout: 180000,
          proxyTimeout: 180000,
        },
      },
    },
  },
} satisfies UserConfigExport<'webpack5'>
