const DEFAULT_CORS_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
  'http://localhost:10086',
  'http://127.0.0.1:10086',
]

function parseCorsOrigin(value: string | undefined) {
  const normalizedValue = value?.trim()
  if (!normalizedValue) {
    return DEFAULT_CORS_ORIGINS
  }

  if (normalizedValue === '*') {
    return true
  }

  return normalizedValue
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean)
}

/**
 * 环境变量配置
 */
export const env = {
  // AI Provider Configuration
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL || 'https://api.deepseek.com',
  AI_MODEL: process.env.AI_MODEL || 'deepseek-chat',
  AI_FALLBACK_MODELS: (process.env.AI_FALLBACK_MODELS || '')
    .split(',')
    .map((model) => model.trim())
    .filter(Boolean),
  PROMPT_VARIANT: process.env.PROMPT_VARIANT || 'v1',

  // GLM-OCR Configuration
  GLM_API_KEY: process.env.GLM_API_KEY || '',
  GLM_ENDPOINT: process.env.GLM_ENDPOINT || '',
  GLM_BASE_URL: process.env.GLM_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4',
  GLM_OCR_API_KEY: process.env.GLM_OCR_API_KEY || '',
  GLM_OCR_ENDPOINT: process.env.GLM_OCR_ENDPOINT || '',
  GLM_OCR_BASE_URL: process.env.GLM_OCR_BASE_URL || '',
  GLM_OCR_MODEL: process.env.GLM_OCR_MODEL || 'glm-ocr',
  OCR_TIMEOUT_MS: parseInt(process.env.OCR_TIMEOUT_MS || '150000', 10),
  OCR_MAX_FILE_SIZE_MB: parseInt(process.env.OCR_MAX_FILE_SIZE_MB || '10', 10),

  // Server Configuration
  PORT: parseInt(process.env.PORT || '3000', 10),
  HOST: process.env.HOST || '0.0.0.0',

  // CORS Configuration
  CORS_ORIGIN: parseCorsOrigin(process.env.CORS_ORIGIN),
}

export function getOcrEnvStatus() {
  const hasApiKey = Boolean(env.GLM_OCR_API_KEY || env.GLM_API_KEY)
  const endpoint = env.GLM_OCR_ENDPOINT || env.GLM_ENDPOINT || env.GLM_OCR_BASE_URL || env.GLM_BASE_URL
  const hasEndpoint = Boolean(endpoint)
  const timeoutValid = Number.isFinite(env.OCR_TIMEOUT_MS) && env.OCR_TIMEOUT_MS > 0
  const maxFileSizeValid = Number.isFinite(env.OCR_MAX_FILE_SIZE_MB) && env.OCR_MAX_FILE_SIZE_MB > 0
  const missing: string[] = []

  if (!hasApiKey) {
    missing.push('GLM_OCR_API_KEY 或 GLM_API_KEY')
  }

  if (!hasEndpoint) {
    missing.push('GLM_OCR_ENDPOINT / GLM_ENDPOINT / GLM_OCR_BASE_URL / GLM_BASE_URL')
  }

  if (!timeoutValid) {
    missing.push('OCR_TIMEOUT_MS')
  }

  if (!maxFileSizeValid) {
    missing.push('OCR_MAX_FILE_SIZE_MB')
  }

  return {
    configured: missing.length === 0,
    missing,
    model: env.GLM_OCR_MODEL,
    endpoint,
    timeoutMs: env.OCR_TIMEOUT_MS,
    maxFileSizeMb: env.OCR_MAX_FILE_SIZE_MB,
  }
}

/**
 * 验证必需的环境变量
 */
export function validateEnv() {
  if (!env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is required in environment variables')
  }

  if (!Number.isFinite(env.PORT) || env.PORT <= 0) {
    throw new Error('PORT must be a positive number')
  }

  const ocrStatus = getOcrEnvStatus()
  if (!ocrStatus.configured) {
    console.warn(`⚠️ OCR 配置未完整，文件解析接口将不可用：缺少 ${ocrStatus.missing.join('、')}`)
  }
}
