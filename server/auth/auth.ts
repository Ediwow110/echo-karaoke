import { betterAuth } from 'better-auth';
import { Pool } from 'pg';
import { anonymous, jwt } from 'better-auth/plugins';
import { resolveBaseUrl, resolveTrustedOrigins } from './origins';

const baseURL = resolveBaseUrl();

export const auth = betterAuth({
  appName: 'ECHO',
  baseURL,
  secret: process.env.BETTER_AUTH_SECRET ?? '',
  database: new Pool({
    connectionString: process.env.AUTH_DATABASE_URL ?? '',
    max: 3,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    allowExitOnIdle: true,
  }),
  trustedOrigins: resolveTrustedOrigins(process.env, baseURL),
  advanced: { cookiePrefix: 'echo' },
  plugins: [anonymous(), jwt()],
});
