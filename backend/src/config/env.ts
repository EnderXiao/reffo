const NONPROD_CORS_ORIGIN = 'https://reffo-web-nonprod.onrender.com'

const DEFAULT_CORS_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
  'http://localhost:10086',
  'http://127.0.0.1:10086',
  NONPROD_CORS_ORIGIN,
]

function parseCorsOrigin(value: string | undefined, appEnv: AppEnv) {
  const normalizedValue = value?.trim()
  if (!normalizedValue) {
    return DEFAULT_CORS_ORIGINS
  }

  if (normalizedValue === '*') {
    return true
  }

  const origins = normalizedValue
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean)

  if (appEnv === 'nonprod' && !origins.includes(NONPROD_CORS_ORIGIN)) {
    origins.push(NONPROD_CORS_ORIGIN)
  }

  return origins
}

type AppEnv = 'local' | 'nonprod' | 'prod'
type SupabaseProjectEnv = 'nonprod' | 'prod' | ''
type DatabaseProvider = 'sqlite' | 'supabase'

function parseAppEnv(value: string | undefined): AppEnv {
  const normalizedValue = value?.trim().toLowerCase()

  if (normalizedValue === 'nonprod' || normalizedValue === 'prod') {
    return normalizedValue
  }

  return 'local'
}

function parseDatabaseProvider(value: string | undefined): DatabaseProvider {
  const normalizedValue = value?.trim().toLowerCase()

  if (normalizedValue === 'supabase') {
    return 'supabase'
  }

  return 'sqlite'
}

function parseSupabaseProjectEnv(value: string | undefined): SupabaseProjectEnv {
  const normalizedValue = value?.trim().toLowerCase()

  if (normalizedValue === 'nonprod' || normalizedValue === 'prod') {
    return normalizedValue
  }

  return ''
}

function parseBoolean(value: string | undefined, fallback: boolean) {
  const normalizedValue = value?.trim().toLowerCase()

  if (!normalizedValue) {
    return fallback
  }

  return ['1', 'true', 'yes', 'on'].includes(normalizedValue)
}

function parsePositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value || '', 10)

  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

/**
 * 环境变量配置
 */
export const env = {
  // Runtime Environment
  APP_ENV: parseAppEnv(process.env.APP_ENV),
  DATABASE_PROVIDER: parseDatabaseProvider(process.env.DATABASE_PROVIDER),
  AUTH_REQUIRED: parseBoolean(process.env.AUTH_REQUIRED, parseAppEnv(process.env.APP_ENV) === 'prod'),
  DEV_USER_ID: process.env.DEV_USER_ID || '00000000-0000-4000-8000-000000000001',

  // Supabase Configuration
  SUPABASE_URL: process.env.SUPABASE_URL || '',
  SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY || '',
  SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY || '',
  SUPABASE_PROJECT_ENV: parseSupabaseProjectEnv(process.env.SUPABASE_PROJECT_ENV),
  SUPABASE_STORAGE_BUCKET: process.env.SUPABASE_STORAGE_BUCKET || 'user-files',
  AUTH_OTP_LENGTH: parsePositiveInteger(process.env.AUTH_OTP_LENGTH, 6),
  AUTH_OTP_RESEND_SECONDS: parsePositiveInteger(process.env.AUTH_OTP_RESEND_SECONDS, 60),
  AUTH_PASSWORD_ENCRYPTION_PRIVATE_KEY: process.env.AUTH_PASSWORD_ENCRYPTION_PRIVATE_KEY || '',

  // Harness runtime database
  HARNESS_DATABASE_PATH: process.env.HARNESS_DATABASE_PATH || '',
  HARNESS_RETENTION_DAYS: parseInt(process.env.HARNESS_RETENTION_DAYS || '7', 10),
  HARNESS_MAX_RUNS: parseInt(process.env.HARNESS_MAX_RUNS || '1000', 10),

  // AI Provider Configuration
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL || 'https://api.deepseek.com',
  AI_MODEL: process.env.AI_MODEL || 'deepseek-chat',
  AI_FALLBACK_MODELS: (process.env.AI_FALLBACK_MODELS || '')
    .split(',')
    .map((model) => model.trim())
    .filter(Boolean),
  JINA_API_KEY: process.env.JINA_API_KEY || '',
  WEB_RESEARCH_TIMEOUT_MS: parseInt(process.env.WEB_RESEARCH_TIMEOUT_MS || '20000', 10),
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
  CORS_ORIGIN: parseCorsOrigin(process.env.CORS_ORIGIN, parseAppEnv(process.env.APP_ENV)),
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

  if (!Number.isFinite(env.HARNESS_RETENTION_DAYS) || env.HARNESS_RETENTION_DAYS < 0) {
    throw new Error('HARNESS_RETENTION_DAYS must be a non-negative number')
  }

  if (!Number.isFinite(env.HARNESS_MAX_RUNS) || env.HARNESS_MAX_RUNS < 0) {
    throw new Error('HARNESS_MAX_RUNS must be a non-negative number')
  }

  if (env.APP_ENV !== 'local') {
    if (env.DATABASE_PROVIDER !== 'supabase') {
      throw new Error('DATABASE_PROVIDER must be supabase when APP_ENV is non-local')
    }

    if (!env.AUTH_REQUIRED) {
      throw new Error('AUTH_REQUIRED cannot be false when APP_ENV is non-local')
    }

    if (!env.AUTH_PASSWORD_ENCRYPTION_PRIVATE_KEY) {
      console.warn('⚠️ AUTH_PASSWORD_ENCRYPTION_PRIVATE_KEY 未配置，当前实例将使用临时密钥；多实例部署前必须配置稳定私钥')
    }
  }

  if (env.APP_ENV === 'prod') {

    if (process.env.DEV_USER_ID) {
      throw new Error('DEV_USER_ID cannot be set when APP_ENV=prod')
    }

    if (env.SUPABASE_PROJECT_ENV !== 'prod') {
      throw new Error('SUPABASE_PROJECT_ENV must be prod when APP_ENV=prod')
    }
  }

  if (env.DATABASE_PROVIDER === 'supabase') {
    const missing = [
      ['SUPABASE_URL', env.SUPABASE_URL],
      ['SUPABASE_PUBLISHABLE_KEY', env.SUPABASE_PUBLISHABLE_KEY],
      ['SUPABASE_SECRET_KEY', env.SUPABASE_SECRET_KEY],
    ].filter(([, value]) => !value)

    if (missing.length > 0) {
      throw new Error(`Supabase 配置未完整：缺少 ${missing.map(([name]) => name).join('、')}`)
    }

    if (!env.SUPABASE_PROJECT_ENV) {
      throw new Error('Supabase 配置未完整：缺少 SUPABASE_PROJECT_ENV')
    }

    if (env.APP_ENV === 'nonprod' && env.SUPABASE_PROJECT_ENV !== 'nonprod') {
      throw new Error('SUPABASE_PROJECT_ENV must be nonprod when APP_ENV=nonprod')
    }
  }

  const ocrStatus = getOcrEnvStatus()
  if (!ocrStatus.configured) {
    console.warn(`⚠️ OCR 配置未完整，文件解析接口将不可用：缺少 ${ocrStatus.missing.join('、')}`)
  }
}
