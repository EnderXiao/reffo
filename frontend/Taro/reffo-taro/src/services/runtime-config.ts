import {apiClient} from './api';

export type RuntimeAppEnv = 'local' | 'nonprod' | 'prod';

export interface PublicRuntimeConfig {
  appEnv: RuntimeAppEnv;
  databaseProvider: 'sqlite' | 'supabase';
  supabase: {
    url: string;
    publishableKey: string;
    storageBucket: string;
    projectEnv: 'nonprod' | 'prod' | '';
  };
}

export interface SupabasePublicConfig {
  url: string;
  publishableKey: string;
  storageBucket: string;
}

let runtimeConfigPromise: Promise<PublicRuntimeConfig> | null = null;

export function getPublicRuntimeConfig(): Promise<PublicRuntimeConfig> {
  if (!runtimeConfigPromise) {
    runtimeConfigPromise = apiClient.get<PublicRuntimeConfig>('/system/public-config', {
      timeout: 10000,
    });
  }

  return runtimeConfigPromise;
}

export function resetPublicRuntimeConfigCache(): void {
  runtimeConfigPromise = null;
}

export async function getSupabasePublicConfig(): Promise<SupabasePublicConfig> {
  const config = await getPublicRuntimeConfig();
  const supabaseUrl = config.supabase.url?.replace(/\/+$/, '') || '';
  const publishableKey = config.supabase.publishableKey || '';
  const storageBucket = config.supabase.storageBucket || 'user-files';

  if (!supabaseUrl || !publishableKey) {
    throw new Error('Supabase Auth 未配置');
  }

  return {
    url: supabaseUrl,
    publishableKey,
    storageBucket,
  };
}
