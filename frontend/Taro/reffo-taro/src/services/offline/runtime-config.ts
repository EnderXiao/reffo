export type RuntimeAppEnv = 'local' | 'nonprod' | 'prod'

export interface PublicRuntimeConfig {
  appEnv: RuntimeAppEnv
  databaseProvider: 'sqlite' | 'supabase'
  supabase: {
    url: string
    publishableKey: string
    storageBucket: string
    projectEnv: 'nonprod' | 'prod' | ''
  }
}

export interface SupabasePublicConfig {
  url: string
  publishableKey: string
  storageBucket: string
}

export function getPublicRuntimeConfig(): Promise<PublicRuntimeConfig> {
  return Promise.resolve({
    appEnv: 'local',
    databaseProvider: 'sqlite',
    supabase: {
      url: '',
      publishableKey: '',
      storageBucket: '',
      projectEnv: '',
    },
  })
}

export async function isLocalRuntimeEnvironment(): Promise<boolean> {
  return true
}

export function resetPublicRuntimeConfigCache() {}

export async function getSupabasePublicConfig(): Promise<SupabasePublicConfig> {
  throw new Error('离线小工具不使用 Supabase')
}
