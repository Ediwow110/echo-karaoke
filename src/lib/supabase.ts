import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { readPublicConfig } from './publicConfig';

let client: SupabaseClient | null = null;
let validatedToken: string | null = null;
let pendingSession: Promise<string> | null = null;

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

async function sessionIsValid(supabase: SupabaseClient, accessToken: string): Promise<boolean | null> {
  const checked = await supabase.auth.getUser(accessToken);
  if (checked.error === null && checked.data.user !== null) {
    return true;
  }
  const status = checked.error?.status;
  if (status !== 401 && status !== 403) {
    // Auth was unreachable rather than invalid; keep the stored session so the
    // room request can report the real network state.
    return null;
  }
  return false;
}

export function ensureAnonymousSession(supabase: SupabaseClient): Promise<string> {
  if (pendingSession !== null) {
    return pendingSession;
  }

  pendingSession = resolveSession(supabase).finally(() => {
    pendingSession = null;
  });
  return pendingSession;
}

async function resolveSession(supabase: SupabaseClient): Promise<string> {
  const existing = await supabase.auth.getSession();
  const existingToken = existing.data.session?.access_token;
  if (existingToken !== undefined && existingToken.length > 0) {
    if (validatedToken === existingToken) {
      return existingToken;
    }

    const valid = await sessionIsValid(supabase, existingToken);
    if (valid !== false) {
      if (valid === true) {
        validatedToken = existingToken;
      }
      return existingToken;
    }

    await supabase.auth.signOut({ scope: 'local' });
  }

  const created = await supabase.auth.signInAnonymously();
  const accessToken = created.data.session?.access_token;
  if (created.error !== null || accessToken === undefined) {
    throw new Error('Could not start a guest session. Try reloading the page.');
  }
  validatedToken = accessToken;
  return accessToken;
}
