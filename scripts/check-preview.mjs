#!/usr/bin/env node
import { pathToFileURL } from 'node:url';

const REQUIRED_CSP_DIRECTIVES = ["default-src 'self'", "frame-ancestors 'none'", 'connect-src'];
const SHARED_SUPABASE_WILDCARD = 'https://*.supabase.co';

export function expectedSupabaseOrigin(env = process.env) {
  const raw = (env.VITE_SUPABASE_URL ?? env.SUPABASE_URL ?? '').trim();
  if (raw.length === 0) {
    return null;
  }
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

function isLoopback(hostname) {
  return hostname === '127.0.0.1' || hostname === 'localhost';
}

export async function checkPreview(input, options = {}) {
  const errors = [];
  const fetchImpl = options.fetchImpl ?? fetch;

  let target;
  try {
    target = new URL(input);
  } catch {
    return { errors: ['The preview URL is not valid.'] };
  }

  if (target.protocol !== 'https:' && !isLoopback(target.hostname)) {
    errors.push('Use HTTPS for a deployed preview.');
  }

  const supabaseOrigin = options.supabaseUrl ?? null;
  const bypassToken = options.bypassToken ?? null;
  // A protected deployment answers with a redirect to the sign-in page, so the
  // bypass token has to travel with every request.
  const requestInit = bypassToken === null
    ? { redirect: 'manual' }
    : { redirect: 'manual', headers: { 'x-vercel-protection-bypass': bypassToken } };

  async function fetchOrReport(url) {
    try {
      return await fetchImpl(url, requestInit);
    } catch {
      errors.push('Could not reach ' + url + '.');
      return null;
    }
  }

  function requireHeader(headers, name, expected) {
    const value = headers.get(name) ?? '';
    if (value.length === 0) {
      errors.push('Missing ' + name + ' header.');
      return value;
    }
    if (expected !== undefined && !value.includes(expected)) {
      errors.push(name + ' does not contain ' + expected + '.');
    }
    return value;
  }

  const home = await fetchOrReport(target.origin + '/');
  if (home !== null) {
    // A protected deployment answers with a redirect to the sign-in page. Every
    // check below would report a missing header, so name the real cause once.
    const location = home.headers.get('location') ?? '';
    if (location.includes('vercel.com/sso-api') || location.includes('/_vercel/')) {
      errors.push('The deployment is behind Vercel Authentication, so the check cannot read it.');
      errors.push('Turn off Vercel Authentication on the project, or read the deployment with a bypass token.');
      return { errors };
    }

    if (home.status !== 200) errors.push('The home page returned ' + home.status + '.');
    const type = home.headers.get('content-type') ?? '';
    if (!type.includes('text/html')) errors.push('The home page is not HTML.');

    requireHeader(home.headers, 'x-content-type-options', 'nosniff');
    requireHeader(home.headers, 'referrer-policy', 'no-referrer');
    requireHeader(home.headers, 'x-frame-options', 'DENY');
    requireHeader(home.headers, 'permissions-policy', 'camera=(self)');
    if (target.protocol === 'https:') requireHeader(home.headers, 'strict-transport-security', 'max-age=');

    const csp = requireHeader(home.headers, 'content-security-policy');
    for (const directive of REQUIRED_CSP_DIRECTIVES) {
      if (!csp.includes(directive)) errors.push('The CSP is missing ' + directive + '.');
    }
    // A project on a custom Supabase domain cannot use the shared wildcard, so
    // the origin the app actually calls is the one that has to be allowed. The
    // wildcard only covers the projects that live under supabase.co.
    const coversOrigin = supabaseOrigin !== null
      && (csp.includes(supabaseOrigin)
        || (supabaseOrigin.endsWith('.supabase.co') && csp.includes(SHARED_SUPABASE_WILDCARD)));
    if (supabaseOrigin === null) {
      if (!csp.includes(SHARED_SUPABASE_WILDCARD)) {
        errors.push('The CSP does not allow a Supabase origin in connect-src.');
      }
    } else if (!coversOrigin) {
      errors.push(
        'The CSP does not allow the Supabase origin ' + supabaseOrigin + ' in connect-src.',
      );
    }

    const html = await home.text();
    if (!html.includes('<title>ECHO')) errors.push('The ECHO title is missing from the HTML.');
    const script = html.match(/<script[^>]+src="([^"]+)"/i)?.[1];
    if (script !== undefined) {
      const asset = await fetchOrReport(new URL(script, target.origin).href);
      if (asset !== null) {
        if (asset.status !== 200) errors.push('The main asset returned ' + asset.status + '.');
        requireHeader(asset.headers, 'cache-control', 'immutable');
      }
    } else {
      errors.push('Could not find the main script asset in the HTML.');
    }
  }

  const route = await fetchOrReport(target.origin + '/room/00000000-0000-0000-0000-000000000000/host');
  if (route !== null) {
    if (route.status !== 200) errors.push('The SPA route returned ' + route.status + '.');
    if (!(route.headers.get('content-type') ?? '').includes('text/html')) {
      errors.push('The SPA route did not return the app HTML.');
    }
  }

  return { errors };
}

export async function main(env = process.env) {
  const input = process.argv[2] ?? env.PREVIEW_URL ?? '';
  if (input.length === 0) {
    console.error('Usage: npm run verify:preview -- https://your-app.example');
    process.exitCode = 1;
    return;
  }

  const bypassToken = (env.PREVIEW_BYPASS_TOKEN ?? env.VERCEL_PROTECTION_BYPASS ?? '').trim();
  const { errors } = await checkPreview(input, {
    supabaseUrl: expectedSupabaseOrigin(env),
    bypassToken: bypassToken.length === 0 ? null : bypassToken,
  });

  if (errors.length > 0) {
    console.error('Preview verification failed:');
    for (const error of errors) console.error('- ' + error);
    process.exitCode = 1;
    return;
  }

  console.log('Preview checks passed for ' + new URL(input).origin + '.');
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
