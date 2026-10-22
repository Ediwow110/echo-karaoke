#!/usr/bin/env node
import { pathToFileURL } from 'node:url';

const TUNNEL_SUFFIX = '.trycloudflare.com';
const PUBLISHABLE_PREFIX = 'sb_publishable_';

/**
 * Reads the role out of a legacy Supabase key, which is a JWT whose payload
 * carries it. The browser only ever gets the anon key, so anything that names
 * a stronger role must never reach the bundle.
 */
export function keyRole(key) {
  const trimmed = key.trim();
  if (trimmed.startsWith(PUBLISHABLE_PREFIX)) {
    return 'anon';
  }
  if (trimmed.startsWith('sb_secret_')) {
    return 'secret';
  }
  const parts = trimmed.split('.');
  if (parts.length !== 3) {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return typeof payload.role === 'string' ? payload.role : null;
  } catch {
    return null;
  }
}

export function checkDeployEnv(env = process.env) {
  const errors = [];
  const url = (env.VITE_SUPABASE_URL ?? '').trim();
  const anonKey = (env.VITE_SUPABASE_ANON_KEY ?? '').trim();
  const origins = (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  let parsedUrl = null;
  if (url.length === 0) {
    errors.push('VITE_SUPABASE_URL is required.');
  } else {
    try {
      parsedUrl = new URL(url);
    } catch {
      errors.push('VITE_SUPABASE_URL must be a valid URL.');
    }
  }
  if (parsedUrl !== null) {
    if (parsedUrl.protocol !== 'https:') {
      errors.push('VITE_SUPABASE_URL must use HTTPS.');
    }
    if (parsedUrl.hostname.endsWith(TUNNEL_SUFFIX)) {
      errors.push('VITE_SUPABASE_URL must be a stable project URL, not a trycloudflare tunnel.');
    }
    if (parsedUrl.pathname !== '/' || parsedUrl.search.length > 0 || parsedUrl.hash.length > 0) {
      errors.push('VITE_SUPABASE_URL must be a bare project URL without a path, query, or fragment.');
    }
  }

  if (anonKey.length === 0) {
    errors.push('VITE_SUPABASE_ANON_KEY is required.');
  } else {
    const role = keyRole(anonKey);
    if (role !== 'anon') {
      errors.push('VITE_SUPABASE_ANON_KEY must be the anon or publishable key, not a privileged key.');
    }
  }

  if (origins.length === 0) {
    errors.push('ALLOWED_ORIGINS must list at least one deployed app origin.');
  }
  for (const origin of origins) {
    if (origin === '*') {
      errors.push('ALLOWED_ORIGINS must not contain *.');
      continue;
    }
    try {
      const parsed = new URL(origin);
      if (parsed.protocol !== 'https:') {
        errors.push('ALLOWED_ORIGINS entries must use HTTPS: ' + origin);
      }
      if (parsed.origin !== origin) {
        errors.push('ALLOWED_ORIGINS entries must be bare origins without paths or trailing slashes: ' + origin);
      }
    } catch {
      errors.push('ALLOWED_ORIGINS contains an invalid origin: ' + origin);
    }
  }

  return errors;
}

export function main(env = process.env) {
  const errors = checkDeployEnv(env);
  if (errors.length > 0) {
    console.error('Deployment environment is not production-ready:');
    for (const error of errors) {
      console.error('- ' + error);
    }
    process.exitCode = 1;
    return;
  }
  const host = new URL(env.VITE_SUPABASE_URL.trim()).host;
  console.log('Deployment environment is production-ready for ' + host + '.');
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
