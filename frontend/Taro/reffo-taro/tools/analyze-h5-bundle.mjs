import {readdir, stat} from 'node:fs/promises'
import path from 'node:path'

const root = path.resolve(process.argv[2] || 'dist')
const jsonOutput = process.argv.includes('--json')

async function collectFiles(directory) {
  const entries = await readdir(directory, {withFileTypes: true})
  const files = []

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...await collectFiles(entryPath))
    } else if (/\.(?:js|css)$/i.test(entry.name)) {
      files.push(entryPath)
    }
  }

  return files
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  return `${(bytes / 1024).toFixed(1)} KiB`
}

let files
try {
  files = await collectFiles(root)
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`无法读取 H5 构建目录 ${root}: ${message}`)
  process.exitCode = 1
}

if (!files) process.exit()

const assets = await Promise.all(files.map(async filePath => {
  const bytes = (await stat(filePath)).size
  const relativePath = path.relative(root, filePath)
  return {
    file: relativePath,
    bytes,
    type: path.extname(filePath).slice(1).toLowerCase(),
    entrypoint: /^app\./i.test(path.basename(filePath)),
  }
}))

assets.sort((left, right) => right.bytes - left.bytes)
const totalBytes = assets.reduce((sum, asset) => sum + asset.bytes, 0)
const entrypointBytes = assets
  .filter(asset => asset.entrypoint)
  .reduce((sum, asset) => sum + asset.bytes, 0)

if (jsonOutput) {
  console.log(JSON.stringify({root, totalBytes, entrypointBytes, assets}, null, 2))
} else {
  console.log(`H5 bundle: ${formatBytes(totalBytes)} (${assets.length} JS/CSS assets)`)
  console.log(`Entrypoint app.*: ${formatBytes(entrypointBytes)}`)
  console.log('Largest assets:')
  for (const asset of assets.slice(0, 10)) {
    console.log(`- ${formatBytes(asset.bytes).padStart(10)} ${asset.file}`)
  }
}
