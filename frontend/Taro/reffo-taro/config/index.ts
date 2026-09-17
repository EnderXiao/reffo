import path from 'path';
import fs from 'fs';
import {execFileSync} from 'node:child_process';
import {defineConfig, type UserConfigExport} from '@tarojs/cli';
import TsconfigPathsPlugin from 'tsconfig-paths-webpack-plugin';
import devConfig from './dev';
import prodConfig from './prod';

function resolveReleaseMetadata() {
  const configuredVersion = process.env.REFFO_VERSION?.trim()
  const configuredNotes = process.env.REFFO_RELEASE_NOTES?.trim()
  if (configuredVersion) return {version: configuredVersion, notes: configuredNotes}

  try {
    const repositoryRoot = path.resolve(__dirname, '../../../..')
    const tags = execFileSync('git', ['tag', '--points-at', 'HEAD', '--sort=-version:refname'], {
      cwd: repositoryRoot,
      encoding: 'utf8',
    }).split('\n').map(tag => tag.trim()).filter(tag => /^v\d+\.\d+\.\d+([-.][0-9A-Za-z.-]+)?$/.test(tag))
    const tag = tags[0]
    if (!tag) return {version: undefined, notes: configuredNotes}
    const subject = execFileSync('git', ['for-each-ref', '--format=%(contents:subject)', `refs/tags/${tag}`], {
      cwd: repositoryRoot,
      encoding: 'utf8',
    }).trim()
    const body = execFileSync('git', ['for-each-ref', '--format=%(contents:body)', `refs/tags/${tag}`], {
      cwd: repositoryRoot,
      encoding: 'utf8',
    }).trim()
    const notes = [subject, body].filter(Boolean).join('\n\n')
    return {version: tag.slice(1), notes: configuredNotes || notes}
  } catch {
    return {version: undefined, notes: configuredNotes}
  }
}

class ExternalizeInlineScriptsPlugin {
  apply(compiler: any) {
    compiler.hooks.thisCompilation.tap('ExternalizeInlineScriptsPlugin', (compilation: any) => {
      compilation.hooks.processAssets.tap(
        {
          name: 'ExternalizeInlineScriptsPlugin',
          stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_REPORT,
        },
        () => {
          const asset = compilation.getAsset('index.html')
          if (!asset) return

          const runtimeSource = fs.readFileSync(path.resolve(__dirname, '../src/minitool-runtime.js'))
          compilation.emitAsset(
            'assets/minitool-runtime.js',
            new compiler.webpack.sources.RawSource(runtimeSource),
          )

          let scriptIndex = 0
          const sourceValue = asset.source.source()
          const htmlSource = typeof sourceValue === 'string' ? sourceValue : sourceValue.toString('utf8')
          const html = htmlSource.replace(
            /<script\b([^>]*)>([\s\S]*?)<\/script>/gi,
            (match: string, attributes: string, source: string) => {
              if (/\ssrc\s*=/i.test(attributes)) return match
              if (!source.trim()) return ''

              const assetName = `assets/minitool-runtime-${scriptIndex++}.js`
              compilation.emitAsset(assetName, new compiler.webpack.sources.RawSource(source))
              return `<script${attributes.replace(/\s*(?:type|defer|async)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')} src="./${assetName}"></script>`
            },
          )

          compilation.updateAsset('index.html', new compiler.webpack.sources.RawSource(html))
        },
      )
    })
  }
}

// https://taro-docs.jd.com/docs/next/config#defineconfig-辅助函数
export default defineConfig<'webpack5'>(async (merge, { mode }) => {
  const currentMode = mode || process.env.NODE_ENV || 'development';
  const isDevelopment = currentMode === 'development';
  const releaseMetadata = resolveReleaseMetadata();

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
      publicPath: './',
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
        chain.node.set('global', false);
        chain.output.set('globalObject', 'window');
        chain.plugin('externalize-inline-scripts').use(ExternalizeInlineScriptsPlugin);

        // H5 构建时将 React Native 专属包重定向到浏览器兼容的 mock 模块
        chain.resolve.alias
          .set('@tarojs/components/global.css$', path.resolve(__dirname, '../src/styles/taro-components-global.h5.css'))
          .set('react-native$', path.resolve(__dirname, '../src/__mocks__/h5/react-native.js'))
          .set('@tarojs/components$', path.resolve(__dirname, '../src/__mocks__/h5/taro-components.js'))
          .set('react-native-svg$', path.resolve(__dirname, '../src/__mocks__/h5/react-native-svg.js'))
          .set('expo-image-picker$', path.resolve(__dirname, '../src/__mocks__/h5/expo-image-picker.js'))
          .set('expo-file-system$', path.resolve(__dirname, '../src/__mocks__/h5/expo-file-system.js'))
          .set('three$', path.resolve(__dirname, '../src/__mocks__/h5/three.js'));

        // 注入 process.env，使源码中 process.env.XXX 可以在浏览器环境正常工作
        // 用整个 process.env 对象替换，这样 process.env.API_BASE_URL 等不存在的变量会得到 undefined 而非报错
        chain.plugin('define-process-env').use(
          require('webpack').DefinePlugin,
          [{
            'process.env': JSON.stringify({
              NODE_ENV: isDevelopment ? 'development' : 'production',
              REFFO_ENV: process.env.REFFO_ENV,
              API_BASE_URL: process.env.API_BASE_URL,
              REFFO_VERSION: releaseMetadata.version,
              REFFO_RELEASE_NOTES: releaseMetadata.notes,
            }),
            global: 'window',
          }],
        );
      },
    },
  };

  return merge({}, baseConfig, isDevelopment ? devConfig : prodConfig);
});
