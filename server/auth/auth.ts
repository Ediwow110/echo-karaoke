import { existsSync } from 'node:fs';
import { betterAuth } from 'better-auth';
import { Pool } from 'pg';
import { anonymous, jwt } from 'better-auth/plugins';
import { resolveBaseUrl, resolveTrustedOrigins } from './origins.js';

// Local development reads .env.local before Better Auth validates its secrets.
// Vercel injects the same values directly, so the file is optional everywhere.
if (typeof process.loadEnvFile === 'function' && existsSync('.env.local')) {
  try {
    process.loadEnvFile('.env.local');
  } catch {
    // Read failures leave the injected environment in place.
  }
}

const baseURL = resolveBaseUrl();
const authDatabaseUrl = process.env.VERCEL_ENV === 'preview'
  ? process.env.PREVIEW_AUTH_DATABASE_URL ?? ''
  : process.env.AUTH_DATABASE_URL ?? '';

export const auth = betterAuth({
  appName: 'ECHO',
  baseURL,
  secret: process.env.BETTER_AUTH_SECRET ?? '',
  database: new Pool({
    connectionString: authDatabaseUrl,
    max: 3,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    allowExitOnIdle: true,
  }),
  trustedOrigins: resolveTrustedOrigins(process.env, baseURL),
  advanced: { cookiePrefix: 'echo' },
  plugins: [anonymous(), jwt()],
});
