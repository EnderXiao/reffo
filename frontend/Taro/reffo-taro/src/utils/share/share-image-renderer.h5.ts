import qrcode from 'qrcode-generator'
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

function drawJobCard(
  context: CanvasRenderingContext2D,
  card: JobShareCardSnapshot,
  palette: SharePalette,
) {
  const x = 190
  const y = 265
  const width = 700
  const height = 900
  const scoreHeight = 245

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

  drawLabel(context, 'COMPANY', card.company, x + 55, y + 75, width - 110, palette.accent)
  drawLabel(context, 'NAME', card.display_name, x + 55, y + 225, width - 110, palette.accent)
  drawLabel(context, 'POSITION', card.position, x + 55, y + 385, width - 110, palette.accent)

  context.fillStyle = 'rgba(255,255,255,0.82)'
  setFont(context, 28, 500)
  context.fillText(`Date  ${card.generated_date}`, x + 55, y + 605, width - 110)

  roundedRect(context, x, y + height - scoreHeight, width, scoreHeight, 0)
  context.fillStyle = '#050505'
  context.fill()
  context.fillStyle = '#FFFFFF'
  setFont(context, 118, 500)
  context.fillText(String(card.match_score), x + 55, y + height - 72, 230)
  context.fillStyle = 'rgba(255,255,255,0.62)'
  setFont(context, 30, 500)
  context.fillText('%', x + 245, y + height - 88)
  context.fillText('Match rate', x + 375, y + height - 90, 260)
}

function drawBlankCard(
  context: CanvasRenderingContext2D,
  palette: SharePalette,
  title: string,
  prompt: string,
  action: string,
) {
  const x = 190
  const y = 265
  const width = 700
  const height = 900

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
  context.fillText(title, x + 85, y + 350, width - 170)
  context.fillStyle = '#29313A'
  setFont(context, 32, 500)
  context.fillText(prompt, x + 85, y + 515, width - 170)
  setFont(context, 34, 700)
  context.fillText(action, x + 85, y + 595, width - 170)
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
  context.fillStyle = palette.ink
  setFont(context, 42, 800)
  const title = share.card.kind === 'job'
    ? '用 Reffo 榨干了我的简历和目标岗位描述'
    : share.landing.revealed_title
  context.fillText(title, 105, 1325, 870)

  const bodyLines = share.card.kind === 'job' && share.card.summary_lines.length > 0
    ? share.card.summary_lines.flatMap((line, index) =>
      wrapShareText(index === 0 ? `我得到了：${line}` : line, 24, 2),
    ).slice(0, 5)
    : wrapShareText(share.landing.revealed_body, 24, 4)

  context.fillStyle = '#3E4650'
  setFont(context, 32, 500)
  let y = 1415
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

function drawLanyard(context: CanvasRenderingContext2D) {
  context.fillStyle = '#F5F7F6'
  roundedRect(context, 490, -20, 100, 180, 35)
  context.fill()
  context.fillStyle = '#26323B'
  roundedRect(context, 516, 125, 48, 115, 14)
  context.fill()
  context.fillStyle = '#AAB4BB'
  roundedRect(context, 470, 215, 140, 34, 14)
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

  context.globalAlpha = 0.18
  context.fillStyle = palette.accent
  setFont(context, 170, 800)
  context.fillText('新工牌', 75, 155, 930)
  context.globalAlpha = 1

  drawLanyard(context)
  if (share.card.kind === 'job') drawJobCard(context, share.card, palette)
  else drawBlankCard(context, palette, share.card.title, share.card.prompt, share.card.action)
  drawSummary(context, share, palette)
  drawBottom(context, share, shareUrl, palette)

  return canvasToBlob(canvas)
}
