export type ShareDomRenderEngine = 'html-in-canvas' | 'svg-foreign-object'

type HtmlInCanvasElement = HTMLElement & {
  drawable?: string
}

type HtmlInCanvasCanvas = HTMLCanvasElement & {
  content?: string
  onpaint?: (() => void) | null
  requestPaint?: () => void
  captureElementImage?: (element: Element) => object
}

type HtmlInCanvasContext = CanvasRenderingContext2D & {
  drawElementImage?: (
    source: Element | object,
    dx: number,
    dy: number,
    destinationWidth: number,
    destinationHeight: number,
  ) => void
}

interface CanvasPair {
  source: HTMLCanvasElement
  clone: HTMLCanvasElement
}

export interface ShareDomOverlay {
  source: HTMLCanvasElement
  x: number
  y: number
  width: number
  height: number
}

export interface ShareDomRenderResult {
  canvas: HTMLCanvasElement
  engine: ShareDomRenderEngine
  overlays: ShareDomOverlay[]
}

const STYLE_PROPERTIES_SKIP = new Set([
  'animation-name',
  'animation-duration',
  'animation-delay',
  'transition-property',
  'transition-duration',
  'transition-delay',
  '-webkit-text-fill-color',
  'text-fill-color',
])

const assetDataUrlCache = new Map<string, Promise<string>>()

function nextFrame() {
  return new Promise<void>(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

function loadAssetDataUrl(source: string) {
  if (!source || source.startsWith('data:')) {
    return Promise.resolve(source)
  }

  const cached = assetDataUrlCache.get(source)
  if (cached) return cached

  const pending = fetch(source)
    .then(response => {
      if (!response.ok) return source
      return response.blob().then(blobToDataUrl)
    })
    .catch(() => source)

  assetDataUrlCache.set(source, pending)
  return pending
}

function inlineCssAssetReferences(value: string): string | Promise<string> {
  if (!value.includes('url(')) return value

  const matches = Array.from(value.matchAll(/url\((["']?)(.*?)\1\)/g))
  return Promise.all(matches.map(async match => ({
    match,
    dataUrl: await loadAssetDataUrl(match[2]),
  }))).then(results => results.reduce(
    (result, {match, dataUrl}) => dataUrl === match[2]
      ? result
      : result.replace(match[0], `url("${dataUrl}")`),
    value,
  ))
}

function findExportSource() {
  return document.querySelector<HTMLElement>('[data-share-export-source="true"]')
    || document.querySelector<HTMLElement>('.share-page')
}

function copyCanvasPixels(source: HTMLCanvasElement, clone: HTMLCanvasElement) {
  clone.width = source.width
  clone.height = source.height
  const context = clone.getContext('2d')
  if (!context) return
  context.clearRect(0, 0, clone.width, clone.height)
  context.drawImage(source, 0, 0, clone.width, clone.height)
}

function prepareExportDom() {
  const source = findExportSource()
  if (!source) throw new Error('未找到可导出的分享页 DOM')

  const clone = source.cloneNode(true) as HTMLElement
  clone.classList.add('share-image-export-page')
  clone.removeAttribute('data-share-export-source')
  clone.style.position = 'relative'
  clone.style.inset = 'auto'
  clone.style.width = '450px'
  clone.style.height = '1000px'
  clone.style.minHeight = '1000px'
  clone.style.overflow = 'hidden'

  clone.querySelector('.share-page__back')?.remove()
  clone.querySelector('.share-page__actions')?.remove()
  clone.querySelector('.share-page__side-stage')?.remove()

  const sourceCanvases = Array.from(source.querySelectorAll('canvas'))
  const cloneCanvases = Array.from(clone.querySelectorAll('canvas'))
  const canvasPairs = sourceCanvases.map((canvas, index) => ({
    source: canvas,
    clone: cloneCanvases[index],
  })).filter((pair): pair is CanvasPair => Boolean(pair.clone))
  canvasPairs.forEach(({source: canvasSource, clone: canvasClone}) => {
    copyCanvasPixels(canvasSource, canvasClone)
  })

  return {clone, canvasPairs}
}

function supportsHtmlInCanvas() {
  if (typeof document === 'undefined') return false
  const context = document.createElement('canvas').getContext('2d') as HtmlInCanvasContext | null
  return typeof context?.drawElementImage === 'function'
}

async function waitForInitialPaint(canvas: HtmlInCanvasCanvas) {
  await nextFrame()
  if (typeof canvas.requestPaint !== 'function') return

  await Promise.race([
    new Promise<void>(resolve => {
      canvas.onpaint = () => {
        canvas.onpaint = null
        resolve()
      }
      canvas.requestPaint?.()
    }),
    new Promise<void>(resolve => window.setTimeout(resolve, 120)),
  ])
}

async function renderWithHtmlInCanvas(
  clone: HTMLElement,
  outputWidth: number,
  outputHeight: number,
) {
  const canvas = document.createElement('canvas') as HtmlInCanvasCanvas
  canvas.width = outputWidth
  canvas.height = outputHeight
  canvas.style.position = 'fixed'
  canvas.style.left = '-10000px'
  canvas.style.top = '0'
  canvas.style.width = '450px'
  canvas.style.height = '1000px'
  canvas.style.pointerEvents = 'none'
  canvas.setAttribute('content', 'drawable')

  const drawable = clone as HtmlInCanvasElement
  drawable.setAttribute('drawable', '')
  canvas.appendChild(drawable)
  document.body.appendChild(canvas)

  try {
    await waitForInitialPaint(canvas)
    const context = canvas.getContext('2d') as HtmlInCanvasContext | null
    if (!context?.drawElementImage) throw new Error('当前浏览器不支持 drawElementImage')

    const image = canvas.captureElementImage?.(drawable)
    context.clearRect(0, 0, outputWidth, outputHeight)
    if (image) context.drawElementImage(image, 0, 0, outputWidth, outputHeight)
    else context.drawElementImage(drawable, 0, 0, outputWidth, outputHeight)
    return {canvas, overlays: [] as ShareDomOverlay[]}
  } finally {
    canvas.remove()
    drawable.removeAttribute('drawable')
  }
}

async function inlineElementStyles(source: Element, clone: Element) {
  const sourceElements = [source, ...Array.from(source.querySelectorAll('*'))]
  const cloneElements = [clone, ...Array.from(clone.querySelectorAll('*'))]
  const pseudoRules: string[] = []

  for (let index = 0; index < sourceElements.length; index += 1) {
    const sourceElement = sourceElements[index]
    const cloneElement = cloneElements[index] as HTMLElement | undefined
    if (!cloneElement) continue

    cloneElement.setAttribute('data-reffo-export-node', String(index))
    const computed = window.getComputedStyle(sourceElement)
    for (const property of Array.from(computed)) {
      if (STYLE_PROPERTIES_SKIP.has(property)) continue
      const resolved = inlineCssAssetReferences(computed.getPropertyValue(property))
      const value = resolved instanceof Promise ? await resolved : resolved
      if (value) cloneElement.style.setProperty(property, value)
    }

    for (const pseudoElement of ['::before', '::after']) {
      const pseudo = window.getComputedStyle(sourceElement, pseudoElement)
      if (!pseudo || pseudo.content === 'none') continue
      const declarations: string[] = []
      for (const property of Array.from(pseudo)) {
        if (STYLE_PROPERTIES_SKIP.has(property)) continue
        const resolved = inlineCssAssetReferences(pseudo.getPropertyValue(property))
        const value = resolved instanceof Promise ? await resolved : resolved
        if (value) declarations.push(`${property}: ${value};`)
      }
      pseudoRules.push(
        `[data-reffo-export-node="${index}"]${pseudoElement}{${declarations.join('')}}`,
      )
    }
  }

  if (pseudoRules.length > 0) {
    const style = document.createElement('style')
    style.textContent = pseudoRules.join('')
    clone.insertBefore(style, clone.firstChild)
  }
}

async function replaceCanvasWithImages(
  clone: HTMLElement,
  canvasPairs: CanvasPair[],
  outputWidth: number,
  outputHeight: number,
) {
  const rootRect = clone.getBoundingClientRect()
  const scaleX = outputWidth / Math.max(1, rootRect.width)
  const scaleY = outputHeight / Math.max(1, rootRect.height)
  const overlays: ShareDomOverlay[] = []

  for (const pair of canvasPairs) {
    const dataUrl = pair.source.toDataURL('image/png')
    const image = document.createElement('img')
    image.src = dataUrl
    image.className = pair.clone.className
    image.setAttribute('style', pair.clone.getAttribute('style') || '')
    image.setAttribute('aria-hidden', 'true')
    image.style.opacity = '0'
    const rect = pair.clone.getBoundingClientRect()
    overlays.push({
      source: pair.source,
      x: (rect.left - rootRect.left) * scaleX,
      y: (rect.top - rootRect.top) * scaleY,
      width: rect.width * scaleX,
      height: rect.height * scaleY,
    })
    pair.clone.replaceWith(image)
  }

  return overlays
}

async function loadInlineImages(clone: HTMLElement) {
  const images = Array.from(clone.querySelectorAll('img'))
  await Promise.all(images.map(async image => {
    image.src = await loadAssetDataUrl(image.getAttribute('src') || '')
  }))
}

async function renderWithForeignObject(
  clone: HTMLElement,
  canvasPairs: CanvasPair[],
  outputWidth: number,
  outputHeight: number,
) {
  const watermark = clone.querySelector<HTMLElement>('.share-page__watermark')
  if (watermark) watermark.style.opacity = '0'
  clone.querySelectorAll<HTMLElement>(
    '.reffo-home-card__date-label, .reffo-home-card__date',
  ).forEach(element => {
    element.style.whiteSpace = 'nowrap'
    element.style.flex = '0 0 auto'
  })

  const staging = document.createElement('div')
  staging.style.position = 'fixed'
  staging.style.left = '-10000px'
  staging.style.top = '0'
  staging.style.width = '450px'
  staging.style.height = '1000px'
  staging.style.pointerEvents = 'none'
  staging.appendChild(clone)
  document.body.appendChild(staging)

  try {
    await nextFrame()
    await inlineElementStyles(clone, clone)
    const overlays = await replaceCanvasWithImages(
      clone,
      canvasPairs,
      outputWidth,
      outputHeight,
    )
    await loadInlineImages(clone)

    const serialized = new XMLSerializer().serializeToString(clone)
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="450" height="1000" viewBox="0 0 450 1000"><foreignObject x="0" y="0" width="450" height="1000">${serialized}</foreignObject></svg>`
    const image = new Image()
    image.decoding = 'sync'
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error('DOM 快照渲染超时')), 2400)
      image.onload = () => {
        window.clearTimeout(timer)
        resolve()
      }
      image.onerror = () => {
        window.clearTimeout(timer)
        reject(new Error('DOM 快照渲染失败'))
      }
      image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
    })

    const canvas = document.createElement('canvas')
    canvas.width = outputWidth
    canvas.height = outputHeight
    const context = canvas.getContext('2d')
    if (!context) throw new Error('当前浏览器不支持 Canvas')
    context.drawImage(image, 0, 0, outputWidth, outputHeight)
    return {canvas, overlays}
  } finally {
    staging.remove()
  }
}

export async function renderShareDomToCanvas(
  outputWidth: number,
  outputHeight: number,
): Promise<ShareDomRenderResult> {
  if (typeof document === 'undefined') {
    throw new Error('DOM 分享图仅支持在 H5 环境生成')
  }
  if (document.fonts?.ready) await document.fonts.ready

  const {clone, canvasPairs} = prepareExportDom()
  if (supportsHtmlInCanvas()) {
    try {
      const result = await renderWithHtmlInCanvas(clone, outputWidth, outputHeight)
      return {...result, engine: 'html-in-canvas'}
    } catch (error) {
      console.warn('[ShareImage] html-in-canvas 渲染失败，回退 DOM 快照:', error)
    }
  }

  const result = await renderWithForeignObject(clone, canvasPairs, outputWidth, outputHeight)
  return {...result, engine: 'svg-foreign-object'}
}
