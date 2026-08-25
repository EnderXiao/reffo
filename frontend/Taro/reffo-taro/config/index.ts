import path from 'path';
import {defineConfig, type UserConfigExport} from '@tarojs/cli';
import TsconfigPathsPlugin from 'tsconfig-paths-webpack-plugin';
import devConfig from './dev';
import prodConfig from './prod';

// https://taro-docs.jd.com/docs/next/config#defineconfig-辅助函数
export default defineConfig<'webpack5'>(async (merge, { mode }) => {
  const currentMode = mode || process.env.NODE_ENV || 'development';
  const isDevelopment = currentMode === 'development';

  const baseConfig: UserConfigExport<'webpack5'> = {
    projectName: 'reffo-taro',
    date: '2026-1-27',
    designWidth: 750,
    deviceRatio: {
      640: 2.34 / 2,
      750: 1,
      375: 2,
      828: 1.81 / 2,
    },
    sourceRoot: 'src',
    outputRoot: 'dist',
    plugins: [],
    defineConstants: {},
    env: {
      NODE_ENV: JSON.stringify(currentMode),
    },
    copy: {
      patterns: [],
      options: {},
    },
    framework: 'react',
    compiler: {
      type: 'webpack5',
      prebundle: {
        enable: false,
      },
    },
    cache: {
      enable: false,
    },
    mini: {
      postcss: {
        pxtransform: {
          enable: true,
          config: {},
        },
        cssModules: {
          enable: true,
          config: {
            namingPattern: 'module',
            generateScopedName: '[name]__[local]___[hash:base64:5]',
          },
        },
      },
      webpackChain(chain) {
        chain.resolve.plugin('tsconfig-paths').use(TsconfigPathsPlugin);
      },
    },
    h5: {
      publicPath: '/',
      staticDirectory: 'static',
      output: {
        filename: 'js/[name].[contenthash:8].js',
        chunkFilename: 'js/[name].[contenthash:8].js',
      },
      miniCssExtractPluginOption: {
        ignoreOrder: true,
        filename: 'css/[name].[contenthash].css',
        chunkFilename: 'css/[name].[contenthash].css',
      },
      postcss: {
        autoprefixer: {
          enable: true,
          config: {},
        },
        pxtransform: {
          enable: true,
          config: {
            designWidth: 393,
            baseFontSize: 20,
            minRootSize: 14,
            maxRootSize: 24,
            deviceRatio: {
              393: 2,
              640: 2.34 / 2,
              750: 1,
              828: 1.81 / 2,
            },
          },
        },
        cssModules: {
          enable: true,
          config: {
            namingPattern: 'module',
            generateScopedName: '[name]__[local]___[hash:base64:5]',
          },
        },
      },
      esnextModules: ['taro-ui'],
      webpackChain(chain) {
        chain.resolve.plugin('tsconfig-paths').use(TsconfigPathsPlugin);

        // H5 构建时将 React Native 专属包重定向到浏览器兼容的 mock 模块
        chain.resolve.alias
          .set('@tarojs/components/global.css$', path.resolve(__dirname, '../src/styles/taro-components-global.h5.css'))
          .set('react-native$', path.resolve(__dirname, '../src/__mocks__/h5/react-native.js'))
          .set('@tarojs/components$', path.resolve(__dirname, '../src/__mocks__/h5/taro-components.js'))
          .set('react-native-gesture-handler$', path.resolve(__dirname, '../src/__mocks__/h5/react-native-gesture-handler.js'))
          .set('react-native-svg$', path.resolve(__dirname, '../src/__mocks__/h5/react-native-svg.js'))
          .set('expo-blur$', path.resolve(__dirname, '../src/__mocks__/h5/expo-blur.js'))
          .set('expo-image-picker$', path.resolve(__dirname, '../src/__mocks__/h5/expo-image-picker.js'))
          .set('expo-file-system$', path.resolve(__dirname, '../src/__mocks__/h5/expo-file-system.js'));

        // 注入 process.env，使源码中 process.env.XXX 可以在浏览器环境正常工作
        // 用整个 process.env 对象替换，这样 process.env.API_BASE_URL 等不存在的变量会得到 undefined 而非报错
        chain.plugin('define-process-env').use(
          require('webpack').DefinePlugin,
          [{
            'process.env': JSON.stringify({
              NODE_ENV: isDevelopment ? 'development' : 'production',
              REFFO_ENV: process.env.REFFO_ENV,
              API_BASE_URL: process.env.API_BASE_URL,
            }),
          }],
        );
      },
    },
  };

  return merge({}, baseConfig, isDevelopment ? devConfig : prodConfig);
});
