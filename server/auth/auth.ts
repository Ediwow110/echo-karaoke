import { betterAuth } from 'better-auth';
import { Pool } from 'pg';
import { anonymous, jwt } from 'better-auth/plugins';

export const auth = betterAuth({
  appName: 'ECHO',
  baseURL: process.env.BETTER_AUTH_URL ?? 'http://127.0.0.1:3000',
  secret: process.env.BETTER_AUTH_SECRET ?? '',
  database: new Pool({ connectionString: process.env.AUTH_DATABASE_URL ?? '' }),
  trustedOrigins: [process.env.BETTER_AUTH_URL ?? 'http://127.0.0.1:3000'],
  advanced: { cookiePrefix: 'echo' },
  plugins: [anonymous(), jwt()],
});
