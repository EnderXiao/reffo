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
