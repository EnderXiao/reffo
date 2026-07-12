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
  CORS_ORIGIN: process.env.CORS_ORIGIN || 'http://localhost:5173',
}

/**
 * 验证必需的环境变量
 */
export function validateEnv() {
  if (!env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is required in environment variables')
  }
}
