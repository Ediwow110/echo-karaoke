import { describe, expect, it } from 'vitest';
import { checkDeployEnv } from '../../scripts/check-deploy-env.mjs';

const valid = {
  ALLOWED_ORIGINS: 'https://app.example',
};

describe('deployment environment guard', () => {
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
