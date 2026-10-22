import { describe, expect, it } from 'vitest';
import { checkDeployEnv } from '../../scripts/check-deploy-env.mjs';

// A legacy Supabase key is a JWT whose payload carries the role.
function legacyKey(role: string): string {
  const encode = (value: object): string =>
    btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ iss: 'supabase', role })}.signature`;
}

const valid = {
  VITE_SUPABASE_URL: 'https://project.supabase.co',
  VITE_SUPABASE_ANON_KEY: legacyKey('anon'),
  ALLOWED_ORIGINS: 'https://app.example',
};

describe('deployment environment guard', () => {
  it('accepts a stable HTTPS Supabase URL and explicit origin', () => {
    expect(checkDeployEnv(valid)).toEqual([]);
  });

  it('accepts the publishable key form', () => {
    expect(checkDeployEnv({
      ...valid,
      VITE_SUPABASE_ANON_KEY: 'sb_publishable_abcdefghijklmnopqrstuvwxyz0123456789',
    })).toEqual([]);
  });

  it('refuses a key that carries a privileged role', () => {
    const errors = checkDeployEnv({
      ...valid,
      VITE_SUPABASE_ANON_KEY: legacyKey('service_role'),
    });
    expect(errors).toContain(
      'VITE_SUPABASE_ANON_KEY must be the anon or publishable key, not a privileged key.',
    );
  });

  it('refuses a key that is neither a readable anon key nor a publishable key', () => {
    const errors = checkDeployEnv({
      ...valid,
      VITE_SUPABASE_ANON_KEY: 'not-a-key',
    });
    expect(errors).toContain(
      'VITE_SUPABASE_ANON_KEY must be the anon or publishable key, not a privileged key.',
    );
  });

  it('rejects an ephemeral tunnel and an empty origin allowlist', () => {
    const errors = checkDeployEnv({
      ...valid,
      VITE_SUPABASE_URL: 'https://room.trycloudflare.com',
      ALLOWED_ORIGINS: '',
    });
    expect(errors).toContain(
      'VITE_SUPABASE_URL must be a stable project URL, not a trycloudflare tunnel.',
    );
    expect(errors).toContain('ALLOWED_ORIGINS must list at least one deployed app origin.');
  });

  it('rejects insecure, wildcard, and path-bearing origins', () => {
    const errors = checkDeployEnv({
      ...valid,
      ALLOWED_ORIGINS: 'http://app.example/,*,https://app.example/path',
    });
    expect(errors).toContain('ALLOWED_ORIGINS entries must use HTTPS: http://app.example/');
    expect(errors).toContain('ALLOWED_ORIGINS must not contain *.');
    expect(errors).toContain(
      'ALLOWED_ORIGINS entries must be bare origins without paths or trailing slashes: https://app.example/path',
    );
  });

  it('rejects missing credentials and non-HTTPS Supabase URLs', () => {
    const errors = checkDeployEnv({
      VITE_SUPABASE_URL: 'http://project.example',
      VITE_SUPABASE_ANON_KEY: '',
      ALLOWED_ORIGINS: 'https://app.example',
    });
    expect(errors).toContain('VITE_SUPABASE_URL must use HTTPS.');
    expect(errors).toContain('VITE_SUPABASE_ANON_KEY is required.');
  });
});
