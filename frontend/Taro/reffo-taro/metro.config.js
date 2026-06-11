const path = require('path')
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config')
const { getMetroConfig } = require('@tarojs/rn-supporter')

const projectRoot = __dirname
const srcRoot = path.resolve(projectRoot, 'src')

function createAliasResolver(baseResolver) {
  return (context, moduleName, platform) => {
    if (moduleName.startsWith('@/')) {
      const aliasedPath = path.join(srcRoot, moduleName.slice(2))
      return context.resolveRequest(context, aliasedPath, platform)
    }

    if (typeof baseResolver === 'function') {
      return baseResolver(context, moduleName, platform)
    }

    return context.resolveRequest(context, moduleName, platform)
  }
}

module.exports = (async function () {
  const defaultConfig = getDefaultConfig(projectRoot)
  const taroConfig = await getMetroConfig()
  const baseResolver = taroConfig.resolver?.resolveRequest || defaultConfig.resolver?.resolveRequest

  return mergeConfig(defaultConfig, taroConfig, {
    projectRoot,
    watchFolders: [...new Set([...(taroConfig.watchFolders || []), srcRoot])],
    transformer: {
      ...taroConfig.transformer,
      babelTransformerPath: require.resolve('./metro.transformer.js'),
    },
    resolver: {
      ...taroConfig.resolver,
      resolveRequest: createAliasResolver(baseResolver),
    },
  })
})()
