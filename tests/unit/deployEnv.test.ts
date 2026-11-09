import { describe, expect, it } from 'vitest';
import { checkDeployEnv } from '../../scripts/check-deploy-env.mjs';

const valid = {
  ALLOWED_ORIGINS: 'https://app.example',
  BETTER_AUTH_SECRET: 'a'.repeat(40),
  DATABASE_URL: 'postgresql://service@example/db',
  AUTH_DATABASE_URL: 'postgresql://auth@example/db',
  VERCEL_PROJECT_PRODUCTION_URL: 'app.example',
};

describe('deployment environment guard', () => {
  it('requires a strong cron secret for a production deployment, not preview', () => {
    const production = { ...valid, VERCEL_ENV: 'production' };
    for (const env of [production, { ...production, CRON_SECRET: 'short' }]) {
      const cronError = checkDeployEnv(env).find((message) => message.includes('CRON_SECRET'));
      expect(cronError, 'a missing or short CRON_SECRET must block the build').toBeDefined();
      // The operator hitting this is mid-deploy, so say how to fix it and what breaks without it.
      expect(cronError).toContain('npx vercel env add CRON_SECRET production');
      expect(cronError).toContain('retention');
    }
    expect(checkDeployEnv({ ...production, CRON_SECRET: 'c'.repeat(40) })).toEqual([]);
  });
  it('accepts a list of explicit deployed origins', () => {
    expect(checkDeployEnv(valid)).toEqual([]);
  });

  it('refuses an ALLOWED_ORIGINS entry that is not a pinned deployment origin', () => {
    const errors = checkDeployEnv({
      ...valid,
      ALLOWED_ORIGINS: 'https://app.example,https://app.example.evil.test',
    });
    expect(errors).toContain(
      'ALLOWED_ORIGINS entry is not a pinned deployment origin: https://app.example.evil.test',
    );
  });

  it('allows an explicitly pinned custom auth origin', () => {
    expect(checkDeployEnv({
      ...valid,
      BETTER_AUTH_URL: 'https://karaoke.example',
      ALLOWED_ORIGINS: 'https://app.example,https://karaoke.example',
    })).toEqual([]);
  });

  it('allows the current preview deployment origin', () => {
    expect(checkDeployEnv({
      ...valid,
      VERCEL_ENV: 'preview',
      VERCEL_URL: 'preview-abc.vercel.app',
      PREVIEW_DATABASE_URL: 'postgresql://service@preview/db',
      PREVIEW_AUTH_DATABASE_URL: 'postgresql://auth@preview/db',
      PRODUCTION_DATABASE_ENDPOINT: 'postgresql://example/db',
      PRODUCTION_AUTH_DATABASE_ENDPOINT: 'postgresql://auth.example/db',
      ALLOWED_ORIGINS: 'https://preview-abc.vercel.app,https://app.example',
    })).toEqual([]);
  });

  it('refuses to validate ALLOWED_ORIGINS without a pinned deployment origin', () => {
    const errors = checkDeployEnv({
      ALLOWED_ORIGINS: 'https://app.example',
      BETTER_AUTH_SECRET: 'a'.repeat(40),
      DATABASE_URL: 'postgresql://service@example/db',
      AUTH_DATABASE_URL: 'postgresql://auth@example/db',
    });
    expect(errors).toContain(
      'ALLOWED_ORIGINS cannot be checked without VERCEL_PROJECT_PRODUCTION_URL, VERCEL_URL, or BETTER_AUTH_URL.',
    );
  });

  it('refuses a database connection string in the client environment', () => {
    const errors = checkDeployEnv({
      ...valid,
      VITE_DATABASE_URL: 'postgresql://user:pass@host/db',
    });
    expect(errors).toContain('VITE_DATABASE_URL must never reach the browser bundle.');
  });

  it('refuses a database connection string under any public prefix', () => {
    const errors = checkDeployEnv({
      ...valid,
      VITE_NEON_DATABASE_URL: ' postgres://user:pass@host/db',
    });
    expect(errors).toContain('VITE_NEON_DATABASE_URL must never reach the browser bundle.');
  });

  it('refuses a datastore connection string for any scheme in the client environment', () => {
    const errors = checkDeployEnv({
      ...valid,
      VITE_MONGO_URL: 'mongodb+srv://user:pass@cluster.example/db',
      VITE_REDIS_URL: 'redis://cache.example:6379',
    });
    expect(errors).toContain('VITE_MONGO_URL must never reach the browser bundle.');
    expect(errors).toContain('VITE_REDIS_URL must never reach the browser bundle.');
  });

  it('refuses a connection string embedded inside a longer public value', () => {
    const errors = checkDeployEnv({
      ...valid,
      VITE_LOCAL_NOTE: 'local stack uses postgresql://service@127.0.0.1/app',
    });
    expect(errors).toContain('VITE_LOCAL_NOTE must never reach the browser bundle.');
  });

  it('refuses a credential-bearing URL under a public prefix', () => {
    const errors = checkDeployEnv({
      ...valid,
      VITE_WEBHOOK_URL: 'https://service:s3cret@hooks.example/path',
    });
    expect(errors).toContain('VITE_WEBHOOK_URL must never reach the browser bundle.');
  });

  it('refuses a private key under a public prefix', () => {
    const errors = checkDeployEnv({
      ...valid,
      VITE_SIGNING_KEY: '-----BEGIN PRIVATE KEY-----\nMIIEexample',
    });
    expect(errors).toContain('VITE_SIGNING_KEY must never reach the browser bundle.');
  });

  it('accepts public configuration that contains no credentials', () => {
    expect(checkDeployEnv({
      ...valid,
      VITE_API_BASE_URL: '/api',
      VITE_ANALYTICS_ENDPOINT: 'https://stats.example/collect',
      VITE_APP_NAME: 'kara-echo',
    })).toEqual([]);
  });

  it('accepts a relative API base path', () => {
    expect(checkDeployEnv({
      ...valid,
      VITE_API_BASE_URL: '/api',
    })).toEqual([]);
  });

  it('refuses an API base that is not one of the deployed origins', () => {
    expect(checkDeployEnv({
      ...valid,
      VITE_API_BASE_URL: 'https://other.example',
    })).toContain('VITE_API_BASE_URL must share an origin with ALLOWED_ORIGINS.');
  });

  it('rejects an empty origin allowlist', () => {
    expect(checkDeployEnv({ ALLOWED_ORIGINS: '' })).toContain(
      'ALLOWED_ORIGINS must list at least one deployed app origin.',
    );
  });

  it('rejects a missing auth secret or database credential', () => {
    const errors = checkDeployEnv({ ALLOWED_ORIGINS: 'https://app.example' });
    expect(errors).toContain('BETTER_AUTH_SECRET must contain at least 32 characters.');
    expect(errors).toContain('DATABASE_URL must be a PostgreSQL connection string.');
    expect(errors).toContain('AUTH_DATABASE_URL must be a PostgreSQL connection string.');
  });

  it('rejects a search budget above the separate 100-call bucket', () => {
    expect(checkDeployEnv({
      ...valid,
      YOUTUBE_DAILY_SEARCH_BUDGET: '101',
    })).toContain('YOUTUBE_DAILY_SEARCH_BUDGET must be an integer between 1 and 100.');
  });

  it('keeps user searches and karaoke picks inside the 100-call bucket', () => {
    expect(checkDeployEnv({
      ...valid,
      YOUTUBE_DAILY_SEARCH_BUDGET: '90',
      YOUTUBE_DAILY_POPULAR_BUDGET: '6',
    })).toEqual([]);
    expect(checkDeployEnv({
      ...valid,
      YOUTUBE_DAILY_SEARCH_BUDGET: '95',
      YOUTUBE_DAILY_POPULAR_BUDGET: '6',
    })).toContain(
      'YOUTUBE_DAILY_SEARCH_BUDGET + YOUTUBE_DAILY_POPULAR_BUDGET must be at most 100 (the separate search.list bucket).',
    );
    expect(checkDeployEnv({
      ...valid,
      YOUTUBE_DAILY_POPULAR_BUDGET: '101',
    })).toContain('YOUTUBE_DAILY_POPULAR_BUDGET must be an integer between 1 and 100.');
  });

  it('requires separate preview database branches and pinned production endpoints', () => {
    expect(checkDeployEnv({
      ...valid,
      VERCEL_ENV: 'preview',
    })).toEqual(expect.arrayContaining([
      'PREVIEW_DATABASE_URL must be a PostgreSQL connection string in Preview.',
      'PREVIEW_AUTH_DATABASE_URL must be a PostgreSQL connection string in Preview.',
      'PRODUCTION_DATABASE_ENDPOINT must name the production database endpoint in Preview.',
      'PRODUCTION_AUTH_DATABASE_ENDPOINT must name the production auth database endpoint in Preview.',
    ]));
    expect(checkDeployEnv({
      ...valid,
      VERCEL_ENV: 'preview',
      PREVIEW_DATABASE_URL: 'postgresql://service@preview/db',
      PREVIEW_AUTH_DATABASE_URL: 'postgresql://auth@preview/db',
      PRODUCTION_DATABASE_ENDPOINT: 'postgresql://example/db',
      PRODUCTION_AUTH_DATABASE_ENDPOINT: 'postgresql://auth.example/db',
    })).toEqual([]);
  });

  it('does not let a missing production pin skip the parity check', () => {
    const errors = checkDeployEnv({
      ...valid,
      VERCEL_ENV: 'preview',
      PREVIEW_DATABASE_URL: 'postgresql://service@preview/db',
      PREVIEW_AUTH_DATABASE_URL: 'postgresql://auth@preview/db',
    });
    expect(errors).toContain('PRODUCTION_DATABASE_ENDPOINT must name the production database endpoint in Preview.');
    expect(errors).toContain('PRODUCTION_AUTH_DATABASE_ENDPOINT must name the production auth database endpoint in Preview.');
  });

  it('rejects Preview URLs that reuse the pinned production endpoint', () => {
    expect(checkDeployEnv({
      ...valid,
      VERCEL_ENV: 'preview',
      PREVIEW_DATABASE_URL: valid.DATABASE_URL,
      PREVIEW_AUTH_DATABASE_URL: 'postgresql://auth@preview/db',
      PRODUCTION_DATABASE_ENDPOINT: 'postgresql://example/db',
      PRODUCTION_AUTH_DATABASE_ENDPOINT: 'postgresql://auth.example/db',
    })).toContain('PREVIEW_DATABASE_URL must point at a different database than PRODUCTION_DATABASE_ENDPOINT.');
  });

  it('treats a Neon -pooler alias as the same database', () => {
    const errors = checkDeployEnv({
      ...valid,
      VERCEL_ENV: 'preview',
      PREVIEW_DATABASE_URL: 'postgresql://service@ep-cool-name-123-pooler.ap-southeast-1.aws.neon.tech/db',
      PREVIEW_AUTH_DATABASE_URL: 'postgresql://auth@ep-cool-auth-123-pooler.ap-southeast-1.aws.neon.tech/db',
      PRODUCTION_DATABASE_ENDPOINT: 'postgresql://ep-cool-name-123.ap-southeast-1.aws.neon.tech/db',
      PRODUCTION_AUTH_DATABASE_ENDPOINT: 'postgresql://ep-cool-auth-123.ap-southeast-1.aws.neon.tech/db',
    });
    expect(errors).toContain('PREVIEW_DATABASE_URL must point at a different database than PRODUCTION_DATABASE_ENDPOINT.');
    expect(errors).toContain('PREVIEW_AUTH_DATABASE_URL must point at a different database than PRODUCTION_AUTH_DATABASE_ENDPOINT.');
  });

  it('refuses production endpoint pins that contain credentials', () => {
    expect(checkDeployEnv({
      ...valid,
      VERCEL_ENV: 'preview',
      PREVIEW_DATABASE_URL: 'postgresql://service@preview/db',
      PREVIEW_AUTH_DATABASE_URL: 'postgresql://auth@preview-auth/db',
      PRODUCTION_DATABASE_ENDPOINT: 'postgresql://user:pass@example/db',
      PRODUCTION_AUTH_DATABASE_ENDPOINT: 'postgresql://auth.example/db',
    })).toContain('PRODUCTION_DATABASE_ENDPOINT must not contain credentials.');
  });

  it('does not conflate non-Neon pooler-looking hosts', () => {
    expect(checkDeployEnv({
      ...valid,
      VERCEL_ENV: 'preview',
      PREVIEW_DATABASE_URL: 'postgresql://service@db-pooler.example/db',
      PREVIEW_AUTH_DATABASE_URL: 'postgresql://auth@auth-pooler.example/db',
      PRODUCTION_DATABASE_ENDPOINT: 'postgresql://example/db',
      PRODUCTION_AUTH_DATABASE_ENDPOINT: 'postgresql://auth.example/db',
    })).toEqual([]);
  });

  it('validates the metadata attempt budgets', () => {
    expect(checkDeployEnv({
      ...valid,
      YOUTUBE_DAILY_METADATA_ATTEMPT_BUDGET: '0',
    })).toContain('YOUTUBE_DAILY_METADATA_ATTEMPT_BUDGET must be an integer between 1 and 100000.');
  });

  it('rejects insecure, wildcard, and path-bearing origins', () => {
    const errors = checkDeployEnv({
      ALLOWED_ORIGINS: 'http://app.example/,*,https://app.example/path',
    });
    expect(errors).toContain('ALLOWED_ORIGINS entries must use HTTPS: http://app.example/');
    expect(errors).toContain('ALLOWED_ORIGINS must not contain *.');
    expect(errors).toContain(
      'ALLOWED_ORIGINS entries must be bare origins without paths or trailing slashes: https://app.example/path',
    );
  });
});
