import qrcode from 'qrcode-generator'
import REFFO_LOGO from '@/assets/branding/reffo-logo.png'
import type {
  JobShareCardSnapshot,
  PublicShareLink,
} from '@/types/share'
import {
  SHARE_IMAGE_HEIGHT,
  SHARE_IMAGE_WIDTH,
  wrapShareText,
} from '@/utils/share/share-image-spec'

interface SharePalette {
  backgroundTop: string
  backgroundBottom: string
  accent: string
  accentSoft: string
  ink: string
}

const PALETTES: Record<PublicShareLink['theme'], SharePalette> = {
  green: {
    backgroundTop: '#DDF9E8',
    backgroundBottom: '#FFFFFF',
    accent: '#14C972',
    accentSoft: '#BCEBCF',
    ink: '#14251C',
  },
  blue: {
    backgroundTop: '#E2ECFF',
    backgroundBottom: '#FFFFFF',
    accent: '#1677FF',
    accentSoft: '#BBD7FF',
    ink: '#142238',
  },
}

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const safeRadius = Math.min(radius, width / 2, height / 2)
  context.beginPath()
  context.moveTo(x + safeRadius, y)
  context.lineTo(x + width - safeRadius, y)
  context.quadraticCurveTo(x + width, y, x + width, y + safeRadius)
  context.lineTo(x + width, y + height - safeRadius)
  context.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height)
  context.lineTo(x + safeRadius, y + height)
  context.quadraticCurveTo(x, y + height, x, y + height - safeRadius)
  context.lineTo(x, y + safeRadius)
  context.quadraticCurveTo(x, y, x + safeRadius, y)
  context.closePath()
}

function loadLogo(src: string) {
  return new Promise<HTMLImageElement | null>(resolve => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => resolve(null)
    image.src = src
  })
}

function setFont(
  context: CanvasRenderingContext2D,
  size: number,
  weight = 500,
) {
  context.font = `${weight} ${size}px "PingFang SC", "Microsoft YaHei", Arial, sans-serif`
}

function drawLabel(
  context: CanvasRenderingContext2D,
  label: string,
  value: string,
  x: number,
  y: number,
  width: number,
  accent: string,
) {
  context.fillStyle = 'rgba(255,255,255,0.62)'
  setFont(context, 25, 700)
  context.fillText(label, x, y, width)
  context.fillStyle = '#FFFFFF'
  setFont(context, value.length > 18 ? 38 : 46, 700)
  context.fillText(value, x, y + 58, width)
  context.fillStyle = accent
  context.fillRect(x, y + 77, 64, 5)
}

const EXPORT_STYLE_PROPERTIES = [
  'position', 'inset', 'top', 'right', 'bottom', 'left', 'width', 'height',
  'display', 'flex', 'flex-direction', 'align-items', 'justify-content', 'gap',
  'box-sizing', 'margin', 'padding', 'border', 'border-radius', 'overflow', 'clip-path',
  'color', 'background', 'background-color', 'background-image', 'background-clip',
  'box-shadow', 'filter', 'opacity', 'transform', 'transform-origin', 'z-index',
  'mask-image', 'mask-position', 'mask-repeat', 'mask-size', 'mask-composite',
  '-webkit-mask-image', '-webkit-mask-position', '-webkit-mask-repeat', '-webkit-mask-size', '-webkit-mask-composite',
  'font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing',
  'text-align', 'white-space', 'overflow-wrap', 'text-overflow',
]

function findShareCardElement(kind: PublicShareLink['card']['kind']) {
  const source = document.querySelector<HTMLElement>(`[data-share-card-source="${kind}"]`)
  return source?.querySelector<HTMLElement>(
    kind === 'job' ? '.reffo-home-card' : '.share-blank-card',
  ) || source
}

function inlineElementStyles(source: Element, clone: Element) {
  const sourceElements = [source, ...Array.from(source.querySelectorAll('*'))]
  const cloneElements = [clone, ...Array.from(clone.querySelectorAll('*'))]

  sourceElements.forEach((sourceElement, index) => {
    const cloneElement = cloneElements[index]
    if (!cloneElement) return
    const computed = window.getComputedStyle(sourceElement)

    EXPORT_STYLE_PROPERTIES.forEach(property => {
      const value = computed.getPropertyValue(property)
      if (value) (cloneElement as HTMLElement).style.setProperty(property, value)
    })

    Array.from(computed).forEach(property => {
      if (property.startsWith('--')) {
        (cloneElement as HTMLElement).style.setProperty(property, computed.getPropertyValue(property))
      }
    })
  })
}

async function drawShareCardElement(
  context: CanvasRenderingContext2D,
  kind: PublicShareLink['card']['kind'],
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const source = findShareCardElement(kind)
  if (!source) throw new Error('未找到可导出的工卡组件')

  const clone = source.cloneNode(true) as HTMLElement
  inlineElementStyles(source, clone)
  clone.querySelectorAll('canvas').forEach(element => element.remove())
  clone.style.position = 'relative'
  clone.style.inset = 'auto'
  clone.style.width = '210px'
  clone.style.height = '332px'
  clone.style.transform = 'none'
  clone.style.transformOrigin = 'top left'
  clone.style.filter = 'none'
  clone.style.transition = 'none'
  clone.style.animation = 'none'

  const wrapper = document.createElement('div')
  wrapper.style.position = 'relative'
  wrapper.style.width = '210px'
  wrapper.style.height = '332px'
  wrapper.style.overflow = 'hidden'
  wrapper.appendChild(clone)

  const serialized = new XMLSerializer().serializeToString(wrapper)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="210" height="332" viewBox="0 0 210 332"><foreignObject x="0" y="0" width="210" height="332">${serialized}</foreignObject></svg>`
  const image = new Image()
  image.decoding = 'sync'
  await new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('工卡快照渲染超时')), 1800)
    image.onload = () => {
      window.clearTimeout(timer)
      resolve()
    }
    image.onerror = () => {
      window.clearTimeout(timer)
      reject(new Error('工卡快照渲染失败'))
    }
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  })

  context.save()
  context.shadowColor = kind === 'job' ? 'rgba(25, 47, 36, 0.22)' : 'rgba(38, 80, 139, 0.18)'
  context.shadowBlur = 32
  context.shadowOffsetY = 22
  context.drawImage(image, x, y, width, height)
  context.restore()
}

function drawJobCard(
  context: CanvasRenderingContext2D,
  card: JobShareCardSnapshot,
  palette: SharePalette,
) {
  const x = 246
  const y = 250
  const width = 588
  const height = 930
  const scoreHeight = 238

  context.save()
  context.shadowColor = 'rgba(25, 47, 36, 0.22)'
  context.shadowBlur = 32
  context.shadowOffsetY = 22
  roundedRect(context, x, y, width, height, 30)
  context.fillStyle = '#18241D'
  context.fill()
  context.restore()

  context.save()
  roundedRect(context, x, y, width, height - scoreHeight, 30)
  context.clip()
  const gradient = context.createLinearGradient(x, y, x + width, y + height)
  gradient.addColorStop(0, palette.accentSoft)
  gradient.addColorStop(1, palette.accent)
  context.fillStyle = gradient
  context.fillRect(x, y, width, height - scoreHeight)

  context.fillStyle = 'rgba(255,255,255,0.18)'
  for (let row = 0; row < 5; row += 1) {
    for (let column = 0; column < 6; column += 1) {
      context.beginPath()
      context.arc(x + 54 + column * 128, y + 30 + row * 132, 54, 0, Math.PI * 2)
      context.fill()
    }
  }
  context.restore()

  drawLabel(context, 'COMPANY', card.company, x + 48, y + 70, width - 96, palette.accent)
  drawLabel(context, 'NAME', card.display_name, x + 48, y + 220, width - 96, palette.accent)
  drawLabel(context, 'POSITION', card.position, x + 48, y + 370, width - 96, palette.accent)

  context.fillStyle = 'rgba(255,255,255,0.82)'
  setFont(context, 28, 500)
  context.fillText(`Date  ${card.generated_date}`, x + 48, y + 595, width - 96)

  roundedRect(context, x, y + height - scoreHeight, width, scoreHeight, 0)
  context.fillStyle = '#050505'
  context.fill()
  context.fillStyle = '#FFFFFF'
  setFont(context, 112, 500)
  context.fillText(String(card.match_score), x + 48, y + height - 70, 210)
  context.fillStyle = 'rgba(255,255,255,0.62)'
  setFont(context, 30, 500)
  context.fillText('%', x + 210, y + height - 86)
  context.fillText('Match rate', x + 320, y + height - 88, 220)
}

function drawBlankCard(
  context: CanvasRenderingContext2D,
  palette: SharePalette,
  title: string,
  prompt: string,
  action: string,
) {
  const x = 246
  const y = 250
  const width = 588
  const height = 930

  context.save()
  context.shadowColor = 'rgba(38, 80, 139, 0.18)'
  context.shadowBlur = 32
  context.shadowOffsetY = 22
  roundedRect(context, x, y, width, height, 30)
  context.fillStyle = 'rgba(255,255,255,0.82)'
  context.fill()
  context.restore()

  roundedRect(context, x + 7, y + 7, width - 14, height - 14, 25)
  context.strokeStyle = palette.accent
  context.lineWidth = 7
  context.stroke()

  const glass = context.createLinearGradient(x, y, x + width, y + height)
  glass.addColorStop(0, 'rgba(255,255,255,0.82)')
  glass.addColorStop(0.58, 'rgba(255,255,255,0.42)')
  glass.addColorStop(1, 'rgba(203,225,255,0.76)')
  roundedRect(context, x + 18, y + 18, width - 36, height - 36, 20)
  context.fillStyle = glass
  context.fill()

  context.fillStyle = palette.accent
  setFont(context, 58, 700)
  context.fillText(title, x + 70, y + 350, width - 140)
  context.fillStyle = '#29313A'
  setFont(context, 32, 500)
  context.fillText(prompt, x + 70, y + 515, width - 140)
  setFont(context, 34, 700)
  context.fillText(action, x + 70, y + 595, width - 140)
}

async function drawShareCard(
  context: CanvasRenderingContext2D,
  share: PublicShareLink,
  palette: SharePalette,
) {
  try {
    await drawShareCardElement(
      context,
      share.card.kind,
      246,
      250,
      588,
      930,
    )
  } catch (error) {
    console.warn('[ShareImage] 工卡快照不可用，使用兼容绘制:', error)
    if (share.card.kind === 'job') drawJobCard(context, share.card, palette)
    else drawBlankCard(context, palette, share.card.title, share.card.prompt, share.card.action)
  }
}

function drawQrCode(
  context: CanvasRenderingContext2D,
  value: string,
  x: number,
  y: number,
  size: number,
) {
  const qr = qrcode(0, 'M')
  qr.addData(value)
  qr.make()
  const moduleCount = qr.getModuleCount()
  const quietZone = 4
  const cellSize = size / (moduleCount + quietZone * 2)

  context.fillStyle = '#FFFFFF'
  roundedRect(context, x, y, size, size, 18)
  context.fill()
  context.fillStyle = '#111111'

  for (let row = 0; row < moduleCount; row += 1) {
    for (let column = 0; column < moduleCount; column += 1) {
      if (!qr.isDark(row, column)) continue
      context.fillRect(
        x + (quietZone + column) * cellSize,
        y + (quietZone + row) * cellSize,
        Math.ceil(cellSize),
        Math.ceil(cellSize),
      )
    }
  }
}

function drawSummary(
  context: CanvasRenderingContext2D,
  share: PublicShareLink,
  palette: SharePalette,
) {
  setFont(context, 42, 800)
  if (share.card.kind === 'job') {
    context.fillStyle = palette.ink
    context.fillText('用 Reffo 榨干了', 105, 1325)

    const referenceWidth = context.measureText('我的简历').width + 34
    roundedRect(context, 380, 1284, referenceWidth, 56, 12)
    context.fillStyle = palette.accentSoft
    context.fill()
    context.fillStyle = palette.accent
    context.fillText('我的简历', 397, 1325)

    context.fillStyle = palette.ink
    context.fillText('和', 397 + referenceWidth, 1325)

    const targetWidth = context.measureText('目标岗位描述').width + 34
    roundedRect(context, 105, 1352, targetWidth, 56, 12)
    context.fillStyle = palette.accentSoft
    context.fill()
    context.fillStyle = palette.accent
    context.fillText('目标岗位描述', 122, 1393)

    context.fillStyle = palette.ink
    context.fillText('，我得到了：', 122 + targetWidth, 1393)
  } else {
    context.fillStyle = palette.ink
    context.fillText(share.landing.revealed_title, 105, 1350, 870)
  }

  const bodyLines = share.card.kind === 'job' && share.card.summary_lines.length > 0
    ? share.card.summary_lines.flatMap(line => wrapShareText(line, 24, 2)).slice(0, 5)
    : wrapShareText(share.landing.revealed_body, 24, 4)

  context.fillStyle = '#3E4650'
  setFont(context, 32, 500)
  let y = 1475
  for (const line of bodyLines) {
    context.fillText(line, 105, y, 870)
    y += 58
  }
}

function drawBottom(
  context: CanvasRenderingContext2D,
  share: PublicShareLink,
  shareUrl: string,
  palette: SharePalette,
) {
  context.fillStyle = 'rgba(33,43,55,0.16)'
  context.fillRect(105, 1805, 870, 2)

  context.fillStyle = palette.accent
  setFont(context, 54, 800)
  context.fillText(share.landing.teaser_title, 115, 1985, 520)
  context.fillText(share.landing.teaser_subtitle, 115, 2065, 560)
  context.fillStyle = '#6F747A'
  setFont(context, 27, 500)
  context.fillText('长按识别二维码，开启全新求职体验', 115, 2145, 540)

  drawQrCode(context, shareUrl, 710, 1880, 260)

  context.fillStyle = '#A0A5AA'
  setFont(context, 20, 500)
  context.fillText('* 接受邀请注册账号，并成功完成一次生成后即可获得额外生成额度', 105, 2315, 870)
}

function drawLanyard(
  context: CanvasRenderingContext2D,
  strapColor: string,
  logo: HTMLImageElement | null,
) {
  context.save()
  context.shadowColor = 'rgba(28, 39, 43, 0.14)'
  context.shadowBlur = 14
  context.shadowOffsetY = 8
  roundedRect(context, 492, -80, 96, 314, 24)
  context.fillStyle = strapColor
  context.fill()
  context.restore()

  context.fillStyle = 'rgba(255,255,255,0.18)'
  for (let y = -76; y < 234; y += 5) context.fillRect(492, y, 96, 1)

  context.strokeStyle = 'rgba(76, 89, 84, 0.12)'
  context.lineWidth = 1
  context.setLineDash([3, 9])
  context.beginPath()
  context.moveTo(503, -62)
  context.lineTo(503, 222)
  context.moveTo(577, -62)
  context.lineTo(577, 222)
  context.stroke()
  context.setLineDash([])

  if (logo) {
    const logoHeight = 34
    const logoWidth = logoHeight * (logo.width / logo.height)
    context.save()
    context.translate(540, 78)
    context.rotate(Math.PI / 2)
    context.globalAlpha = 0.92
    context.drawImage(logo, -logoWidth / 2, -logoHeight / 2, logoWidth, logoHeight)
    context.restore()
  } else {
    context.fillStyle = '#1677FF'
    setFont(context, 18, 800)
    context.save()
    context.translate(540, 82)
    context.rotate(Math.PI / 2)
    context.fillText('reffo', -30, 6)
    context.restore()
  }

  context.save()
  context.shadowColor = 'rgba(15, 22, 24, 0.26)'
  context.shadowBlur = 14
  context.shadowOffsetY = 7
  const metal = context.createLinearGradient(479, 203, 601, 265)
  metal.addColorStop(0, '#727A82')
  metal.addColorStop(0.16, '#ECEFF3')
  metal.addColorStop(0.38, '#A9AEB6')
  metal.addColorStop(0.58, '#F2F3F5')
  metal.addColorStop(0.8, '#858B94')
  metal.addColorStop(1, '#D9DCE2')

  roundedRect(context, 479, 203, 122, 62, 15)
  context.fillStyle = metal
  context.fill()
  context.restore()

  roundedRect(context, 489, 211, 102, 3, 2)
  context.fillStyle = 'rgba(255,255,255,0.46)'
  context.fill()
}

function createCanvas() {
  const canvas = document.createElement('canvas')
  canvas.width = SHARE_IMAGE_WIDTH
  canvas.height = SHARE_IMAGE_HEIGHT
  return canvas
}

function canvasToBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) resolve(blob)
      else reject(new Error('分享图编码失败'))
    }, 'image/png', 0.95)
  })
}

export async function renderShareImage(
  share: PublicShareLink,
  shareUrl: string,
): Promise<Blob> {
  if (typeof document === 'undefined') {
    throw new Error('分享图仅支持在 H5 环境生成')
  }
  if (document.fonts?.ready) await document.fonts.ready

  const canvas = createCanvas()
  const context = canvas.getContext('2d')
  if (!context) throw new Error('当前浏览器不支持 Canvas')

  const palette = PALETTES[share.theme]
  const background = context.createLinearGradient(0, 0, 0, SHARE_IMAGE_HEIGHT)
  background.addColorStop(0, palette.backgroundTop)
  background.addColorStop(0.56, palette.backgroundBottom)
  background.addColorStop(1, '#F7FAFC')
  context.fillStyle = background
  context.fillRect(0, 0, SHARE_IMAGE_WIDTH, SHARE_IMAGE_HEIGHT)

  const watermark = context.createLinearGradient(0, 20, 0, 190)
  watermark.addColorStop(0, 'rgba(255,255,255,0.9)')
  watermark.addColorStop(0.52, 'rgba(255,255,255,0.72)')
  watermark.addColorStop(1, palette.backgroundTop)
  context.fillStyle = watermark
  setFont(context, 170, 800)
  context.fillText('新工牌', 75, 155, 930)

  await drawShareCard(context, share, palette)
  drawLanyard(context, palette.backgroundTop, await loadLogo(REFFO_LOGO))
  drawSummary(context, share, palette)
  drawBottom(context, share, shareUrl, palette)

  return canvasToBlob(canvas)
}
