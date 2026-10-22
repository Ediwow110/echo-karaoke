#!/usr/bin/env node
import { pathToFileURL } from 'node:url';

const CONNECTION_STRING = /^postgres(ql)?:\/\//i;

/**
 * Vite copies every VITE_ variable into the browser bundle. A database URL in
 * that namespace is a credential leak that no later runtime check can undo.
 */
function checkPublicEnvironment(env, errors) {
  for (const [key, raw] of Object.entries(env)) {
    if (!key.startsWith('VITE_')) {
      continue;
    }
    if (CONNECTION_STRING.test(String(raw ?? '').trim())) {
      errors.push(key + ' must never reach the browser bundle.');
    }
  }
}

function checkApiBase(env, origins, errors) {
  const base = String(env.VITE_API_BASE_URL ?? '').trim();
  if (base.length === 0) {
    return;
  }
  if (base.startsWith('//') || base.startsWith('/\\')) {
    errors.push('VITE_API_BASE_URL must be a relative path or an allowed HTTPS origin.');
    return;
  }
  if (base.startsWith('/')) {
    return;
  }
  let parsed = null;
  try {
    parsed = new URL(base);
  } catch {
    errors.push('VITE_API_BASE_URL must be a relative path or a valid URL.');
    return;
  }
  if (parsed.protocol !== 'https:') {
    errors.push('VITE_API_BASE_URL must use HTTPS.');
  }
  if (!origins.includes(parsed.origin)) {
    errors.push('VITE_API_BASE_URL must share an origin with ALLOWED_ORIGINS.');
  }
}

export function checkDeployEnv(env = process.env) {
  const errors = [];
  const origins = String(env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  checkPublicEnvironment(env, errors);
  checkApiBase(env, origins, errors);

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
  const origins = String(env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  console.log('Deployment environment is production-ready for ' + origins.join(', ') + '.');
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
