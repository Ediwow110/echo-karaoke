export type PublicConfig = {
  url: string;
  anonKey: string;
};

/**
 * Validates the public environment without pulling in a database client, so
 * the landing screen can check its configuration without downloading one.
 */
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
