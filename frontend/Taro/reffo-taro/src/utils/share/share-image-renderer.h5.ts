import qrcode from 'qrcode-generator'
import type {PublicShareLink} from '@/types/share'
import {
  SHARE_IMAGE_HEIGHT,
  SHARE_PAGE_IMAGE_HEIGHT,
  SHARE_IMAGE_WIDTH,
} from '@/utils/share/share-image-spec'
import {
  renderShareDomToCanvas,
  type ShareDomOverlay,
} from '@/utils/share/share-image-dom-renderer.h5'

const DESIGN_WIDTH = 393
const FOOTER_SCALE = SHARE_IMAGE_WIDTH / DESIGN_WIDTH
const FOOTER_TOP = 2400
const FOOTER_X = 13 * FOOTER_SCALE
const FOOTER_WIDTH = 363 * FOOTER_SCALE
const FOOTER_DIVIDER_Y = FOOTER_TOP
const FOOTER_QR_LEFT = 281 * FOOTER_SCALE
const FOOTER_QR_TOP = FOOTER_TOP + (813 - 782) * FOOTER_SCALE
const FOOTER_QR_WIDTH = 83 * FOOTER_SCALE
const FOOTER_QR_HEIGHT = 84 * FOOTER_SCALE
const FOOTER_TITLE_LEFT = 52 * FOOTER_SCALE
const FOOTER_TITLE_TOP = FOOTER_QR_TOP
const FOOTER_TITLE_WIDTH = 216 * FOOTER_SCALE
const FOOTER_HINT_LEFT = 73 * FOOTER_SCALE
const FOOTER_HINT_TOP = FOOTER_TOP + (881 - 782) * FOOTER_SCALE
const FOOTER_HINT_WIDTH = 192 * FOOTER_SCALE
const FOOTER_NOTE_LEFT = 35 * FOOTER_SCALE
const FOOTER_NOTE_TOP = FOOTER_TOP + (918 - 782) * FOOTER_SCALE
const FOOTER_NOTE_WIDTH = 341 * FOOTER_SCALE
const WATERMARK_TOP = 12
const WATERMARK_HEIGHT = 352

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

function drawQrCode(
  context: CanvasRenderingContext2D,
  value: string,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const qr = qrcode(0, 'M')
  qr.addData(value)
  qr.make()
  const moduleCount = qr.getModuleCount()
  const quietZone = 4
  const size = Math.min(width, height)
  const left = x + (width - size) / 2
  const top = y + (height - size) / 2
  const cellSize = size / (moduleCount + quietZone * 2)

  context.fillStyle = '#FFFFFF'
  roundedRect(context, left, top, size, size, 18)
  context.fill()
  context.fillStyle = '#111111'

  for (let row = 0; row < moduleCount; row += 1) {
    for (let column = 0; column < moduleCount; column += 1) {
      if (!qr.isDark(row, column)) continue
      context.fillRect(
        left + (quietZone + column) * cellSize,
        top + (quietZone + row) * cellSize,
        Math.ceil(cellSize),
        Math.ceil(cellSize),
      )
    }
  }
}

function drawWatermarkFallback(context: CanvasRenderingContext2D) {
  const gradient = context.createLinearGradient(
    0,
    WATERMARK_TOP,
    0,
    WATERMARK_TOP + WATERMARK_HEIGHT,
  )
  gradient.addColorStop(0, 'rgba(255, 255, 255, 1)')
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)')

  context.save()
  context.fillStyle = gradient
  context.font = `900 ${WATERMARK_HEIGHT}px "PingFang SC", "Microsoft YaHei", Arial, sans-serif`
  context.textAlign = 'center'
  context.textBaseline = 'top'
  context.fillText('新工牌', SHARE_IMAGE_WIDTH / 2, WATERMARK_TOP)
  context.restore()
}

function drawDomOverlays(
  context: CanvasRenderingContext2D,
  overlays: ShareDomOverlay[],
) {
  overlays.forEach(overlay => {
    context.drawImage(
      overlay.source,
      overlay.x,
      overlay.y,
      overlay.width,
      overlay.height,
    )
  })
}

function drawFooter(
  context: CanvasRenderingContext2D,
  share: PublicShareLink,
  shareUrl: string,
) {
  const titleColor = share.theme === 'blue' ? '#1677FF' : '#17C964'

  context.fillStyle = 'rgba(33, 43, 55, 0.16)'
  context.fillRect(FOOTER_X, FOOTER_DIVIDER_Y, FOOTER_WIDTH, 2)

  context.fillStyle = titleColor
  context.font = `600 ${24 * FOOTER_SCALE}px "PingFang SC", "Microsoft YaHei", Arial, sans-serif`
  context.textAlign = 'right'
  context.textBaseline = 'top'
  const titleLineHeight = 34 * FOOTER_SCALE
  context.fillText('一个岗位', FOOTER_TITLE_LEFT + FOOTER_TITLE_WIDTH, FOOTER_TITLE_TOP)
  context.fillText(
    '一份专门准备的简历',
    FOOTER_TITLE_LEFT + FOOTER_TITLE_WIDTH,
    FOOTER_TITLE_TOP + titleLineHeight,
  )

  drawQrCode(
    context,
    shareUrl,
    FOOTER_QR_LEFT,
    FOOTER_QR_TOP,
    FOOTER_QR_WIDTH,
    FOOTER_QR_HEIGHT,
  )

  context.fillStyle = '#000000'
  context.font = `300 ${12 * FOOTER_SCALE}px Inter, "PingFang SC", sans-serif`
  context.textBaseline = 'top'
  context.fillText(
    '长按识别二维码，开启全新求职体验',
    FOOTER_HINT_LEFT + FOOTER_HINT_WIDTH,
    FOOTER_HINT_TOP,
    FOOTER_HINT_WIDTH,
  )

  context.fillStyle = '#8D8D8D'
  context.font = `300 ${10 * FOOTER_SCALE}px "PingFang SC", "Microsoft YaHei", Arial, sans-serif`
  context.textBaseline = 'top'
  context.fillText(
    '*接受邀请注册账号，并成功完成一次生成后即可获得额外生成额度',
    FOOTER_NOTE_LEFT + FOOTER_NOTE_WIDTH,
    FOOTER_NOTE_TOP,
    FOOTER_NOTE_WIDTH,
  )
  context.textAlign = 'left'
  context.textBaseline = 'alphabetic'
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
  const page = await renderShareDomToCanvas(SHARE_IMAGE_WIDTH, SHARE_PAGE_IMAGE_HEIGHT)
  const canvas = document.createElement('canvas')
  canvas.width = SHARE_IMAGE_WIDTH
  canvas.height = SHARE_IMAGE_HEIGHT
  const context = canvas.getContext('2d')
  if (!context) throw new Error('当前浏览器不支持 Canvas')

  context.fillStyle = '#FFFFFF'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(page.canvas, 0, 0)

  if (page.engine === 'svg-foreign-object') {
    drawWatermarkFallback(context)
    drawDomOverlays(context, page.overlays)
  }
  drawFooter(context, share, shareUrl)
  return canvasToBlob(canvas)
}
