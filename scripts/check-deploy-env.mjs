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

function checkBackend(env, errors) {
  const secret = String(env.BETTER_AUTH_SECRET ?? '').trim();
  if (secret.length < 32) {
    errors.push('BETTER_AUTH_SECRET must contain at least 32 characters.');
  }
  const isPreview = env.VERCEL_ENV === 'preview';
  const required = isPreview
    ? ['PREVIEW_DATABASE_URL', 'PREVIEW_AUTH_DATABASE_URL']
    : ['DATABASE_URL', 'AUTH_DATABASE_URL'];
  for (const name of required) {
    const value = String(env[name] ?? '').trim();
    if (!CONNECTION_STRING.test(value)) {
      errors.push(name + ' must be a PostgreSQL connection string'
        + (isPreview ? ' in Preview.' : '.'));
    }
  }
  if (isPreview) {
    const identity = (value) => {
      try {
        const url = new URL(value);
        return url.hostname + url.pathname;
      } catch {
        return null;
      }
    };
    for (const [previewName, productionName] of [
      ['PREVIEW_DATABASE_URL', 'DATABASE_URL'],
      ['PREVIEW_AUTH_DATABASE_URL', 'AUTH_DATABASE_URL'],
    ]) {
      const preview = identity(String(env[previewName] ?? '').trim());
      const production = identity(String(env[productionName] ?? '').trim());
      if (preview !== null && preview === production) {
        errors.push(previewName + ' must point at a different database than ' + productionName + '.');
      }
    }
  }

  const budget = (name, minimum, maximum) => {
    const raw = String(env[name] ?? '').trim();
    if (raw.length === 0) return;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < minimum || value > maximum) {
      errors.push(name + ' must be an integer between ' + minimum + ' and ' + maximum + '.');
    }
  };
  // search.list has a separate 100-call daily bucket.
  budget('YOUTUBE_DAILY_SEARCH_BUDGET', 1, 100);
  budget('YOUTUBE_DAILY_POPULAR_BUDGET', 1, 10000);
  budget('YOUTUBE_DAILY_METADATA_BUDGET', 1, 100000);
  budget('YOUTUBE_ROOM_METADATA_BUDGET', 1, 100000);
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
  checkBackend(env, errors);
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
