import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { secureOrigin } from './secure-url.ts';

let client: SupabaseClient | undefined;

export function getAuthClient(): SupabaseClient {
  if (client) return client;
  const url = import.meta.env.VITE_SUPABASE_URL?.trim();
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !key) throw new Error('请配置 VITE_SUPABASE_URL 和 VITE_SUPABASE_PUBLISHABLE_KEY 后重新构建');
  const origin = secureOrigin(url, 'VITE_SUPABASE_URL');
  if (!key.startsWith('sb_publishable_')) throw new Error('VITE_SUPABASE_PUBLISHABLE_KEY 必须使用 Supabase 公开 publishable key');
  client = createClient(origin, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
  return client;
}
