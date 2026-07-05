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
          target: 'http://localhost:3000',
          changeOrigin: true,
        },
      },
    },
  },
} satisfies UserConfigExport<'webpack5'>
