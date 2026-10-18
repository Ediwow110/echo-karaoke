import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;

export type PublicConfig = {
  url: string;
  anonKey: string;
};

export function readPublicConfig(env: Record<string, string | undefined>): PublicConfig {
  const url = env.VITE_SUPABASE_URL ?? '';
  const anonKey = env.VITE_SUPABASE_ANON_KEY ?? '';

  if (url.length === 0 || anonKey.length === 0) {
    throw new Error(
      'Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your environment.',
    );
  }

  return { url, anonKey };
}

export function getSupabaseClient(env: Record<string, string | undefined>): SupabaseClient {
  if (client !== null) {
    return client;
  }

  const config = readPublicConfig(env);
  client = createClient(config.url, config.anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });
  return client;
}

export async function ensureAnonymousSession(supabase: SupabaseClient): Promise<string> {
  const existing = await supabase.auth.getSession();
  const existingToken = existing.data.session?.access_token;
  if (existingToken !== undefined && existingToken.length > 0) {
    return existingToken;
  }

  const created = await supabase.auth.signInAnonymously();
  const accessToken = created.data.session?.access_token;
  if (created.error !== null || accessToken === undefined) {
    throw new Error('Could not start a guest session. Try reloading the page.');
  }
  return accessToken;
}
