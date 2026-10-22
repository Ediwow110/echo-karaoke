type Environment = Record<string, string | undefined>;

function originFrom(value: string | undefined): string | null {
  const trimmed = (value ?? '').trim();
  if (trimmed.length === 0) {
    return null;
  }
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : 'https://' + trimmed;
  try {
    return new URL(withScheme).origin;
  } catch {
    return null;
  }
}

export function resolveBaseUrl(env: Environment = process.env): string {
  const explicit = (env.BETTER_AUTH_URL ?? '').trim();
  if (explicit.length > 0) {
    return explicit.replace(/\/+$/, '');
  }
  const current = originFrom(env.VERCEL_URL);
  const production = originFrom(env.VERCEL_PROJECT_PRODUCTION_URL);
  if (env.VERCEL_ENV === 'production' && production !== null) {
    return production;
  }
  return current ?? production ?? 'http://127.0.0.1:3000';
}

export function resolveTrustedOrigins(
  env: Environment = process.env,
  baseUrl: string = resolveBaseUrl(env),
): string[] {
  const origins = new Set<string>([baseUrl]);
  for (const host of [env.VERCEL_URL, env.VERCEL_PROJECT_PRODUCTION_URL]) {
    const origin = originFrom(host);
    if (origin !== null) {
      origins.add(origin);
    }
  }
  for (const value of (env.ALLOWED_ORIGINS ?? '').split(',')) {
    const origin = value.trim();
    if (origin.length > 0) {
      origins.add(origin);
    }
  }
  return [...origins];
}
