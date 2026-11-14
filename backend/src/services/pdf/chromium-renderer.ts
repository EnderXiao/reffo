import {chromium, type Browser} from 'playwright'
import {renderResumeHtml, type ResumePdfModel} from './resume-template'

export interface ResumePdfRenderer { render(model: ResumePdfModel): Promise<Uint8Array> }

export class ResumePdfRenderError extends Error {
  readonly code = 'PDF_RENDER_UNAVAILABLE'
  readonly status = 503
  constructor() { super('PDF暂未生成，编辑内容已保留，请稍后重试'); this.name = 'ResumePdfRenderError' }
}

/** A bounded renderer: one browser per worker, a fresh context for every private document. */
export class ChromiumResumePdfRenderer implements ResumePdfRenderer {
  private browser?: Promise<Browser>
  private active = 0

  constructor(private readonly options: {executablePath?: string; timeoutMs?: number; maxConcurrent?: number} = {}) {}

  private async getBrowser(): Promise<Browser> {
    if (!this.browser) {
      this.browser = chromium.launch({headless: true, executablePath: this.options.executablePath})
      this.browser.catch(() => {this.browser = undefined})
    }
    const browser = await this.browser
    if (!browser.isConnected()) {this.browser = undefined; return this.getBrowser()}
    return browser
  }

  async render(model: ResumePdfModel): Promise<Uint8Array> {
    if (this.active >= (this.options.maxConcurrent ?? 1)) throw new ResumePdfRenderError()
    this.active++
    let browserContext: Awaited<ReturnType<Browser['newContext']>> | undefined
    let deadline: ReturnType<typeof setTimeout> | undefined
    let cancelled = false
    try {
      const render = async () => {
        const browser = await this.getBrowser()
        if (cancelled) throw new ResumePdfRenderError()
        const context = await browser.newContext({javaScriptEnabled: false, serviceWorkers: 'block'})
        browserContext = context
        if (cancelled) {
          await context.close().catch(() => undefined)
          throw new ResumePdfRenderError()
        }
        await context.route('**/*', route => route.abort())
        const page = await context.newPage()
        page.setDefaultTimeout(this.options.timeoutMs ?? 20000)
        await page.setContent(renderResumeHtml(model), {waitUntil: 'load'})
        await page.emulateMedia({media: 'print'})
        const bytes = await page.pdf({format: 'A4', preferCSSPageSize: true, printBackground: true, tagged: true})
        if (bytes.length < 100 || bytes.subarray(0, 5).toString() !== '%PDF-') throw new ResumePdfRenderError()
        return new Uint8Array(bytes)
      }
      return await Promise.race([render(), new Promise<never>((_resolve, reject) => {
        deadline = setTimeout(() => reject(new ResumePdfRenderError()), this.options.timeoutMs ?? 20000)
      })])
    } catch { throw new ResumePdfRenderError() }
    finally {
      cancelled = true
      clearTimeout(deadline)
      await browserContext?.close().catch(() => undefined)
      this.active--
    }
  }

  async close() {
    const current = this.browser
    this.browser = undefined
    await current?.then(browser => browser.close()).catch(() => undefined)
  }
}
