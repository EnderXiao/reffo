const taroTransformer = require('@tarojs/rn-supporter/dist/taroTransformer')

function withNodeEnv(options, transform) {
  const previousNodeEnv = process.env.NODE_ENV
  const nextNodeEnv = options?.dev ? 'development' : 'production'

  process.env.NODE_ENV = nextNodeEnv

  try {
    return transform()
  } finally {
    if (previousNodeEnv == null) {
      delete process.env.NODE_ENV
    } else {
      process.env.NODE_ENV = previousNodeEnv
    }
  }
}

module.exports.transform = function transform(params) {
  return withNodeEnv(params?.options, () => taroTransformer.transform(params))
}

module.exports.getCacheKey = taroTransformer.getCacheKey
