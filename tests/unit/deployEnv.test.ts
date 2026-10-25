import { describe, expect, it } from 'vitest';
import { checkDeployEnv } from '../../scripts/check-deploy-env.mjs';

const valid = {
  ALLOWED_ORIGINS: 'https://app.example',
  BETTER_AUTH_SECRET: 'a'.repeat(40),
  DATABASE_URL: 'postgresql://service@example/db',
  AUTH_DATABASE_URL: 'postgresql://auth@example/db',
};

describe('deployment environment guard', () => {
  it('requires a strong cron secret for a production deployment, not preview', () => {
    const production = { ...valid, VERCEL_ENV: 'production' };
    expect(checkDeployEnv(production)).toContain(
      'CRON_SECRET must contain at least 32 characters in Production.',
    );
    expect(checkDeployEnv({ ...production, CRON_SECRET: 'short' })).toContain(
      'CRON_SECRET must contain at least 32 characters in Production.',
    );
    expect(checkDeployEnv({ ...production, CRON_SECRET: 'c'.repeat(40) })).toEqual([]);
  });
  it('accepts a list of explicit deployed origins', () => {
    expect(checkDeployEnv(valid)).toEqual([]);
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

  it('requires separate preview database branches', () => {
    expect(checkDeployEnv({
      ...valid,
      VERCEL_ENV: 'preview',
    })).toEqual(expect.arrayContaining([
      'PREVIEW_DATABASE_URL must be a PostgreSQL connection string in Preview.',
      'PREVIEW_AUTH_DATABASE_URL must be a PostgreSQL connection string in Preview.',
    ]));
    expect(checkDeployEnv({
      ...valid,
      VERCEL_ENV: 'preview',
      PREVIEW_DATABASE_URL: 'postgresql://service@preview/db',
      PREVIEW_AUTH_DATABASE_URL: 'postgresql://auth@preview/db',
    })).toEqual([]);
  });

  it('rejects Preview URLs that reuse the production database', () => {
    expect(checkDeployEnv({
      ...valid,
      VERCEL_ENV: 'preview',
      PREVIEW_DATABASE_URL: valid.DATABASE_URL,
      PREVIEW_AUTH_DATABASE_URL: 'postgresql://auth@preview/db',
    })).toContain('PREVIEW_DATABASE_URL must point at a different database than DATABASE_URL.');
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
