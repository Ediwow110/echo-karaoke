#!/usr/bin/env node
import { pathToFileURL } from 'node:url';

const REQUIRED_CSP_DIRECTIVES = ["default-src 'self'", "frame-ancestors 'none'", "connect-src 'self'"];
const CONNECTION_STRING = /postgres(ql)?:\/\//i;
const CREDENTIAL_ERROR = 'A database connection string is present in the served';

function credentialError(where) {
  return CREDENTIAL_ERROR + ' ' + where + '.';
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

  const bypassToken = options.bypassToken ?? null;
  const baseHeaders = bypassToken === null ? {} : { 'x-vercel-protection-bypass': bypassToken };

  async function fetchOrReport(url, init = {}) {
    try {
      return await fetchImpl(url, {
        redirect: 'manual',
        ...init,
        headers: { ...baseHeaders, ...(init.headers ?? {}) },
      });
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

    const html = await home.text();
    if (!html.includes('<title>ECHO')) errors.push('The ECHO title is missing from the HTML.');
    if (CONNECTION_STRING.test(html)) errors.push(credentialError('HTML'));

    const script = html.match(/<script[^>]+src="([^"]+)"/i)?.[1];
    if (script !== undefined) {
      const asset = await fetchOrReport(new URL(script, target.origin).href);
      if (asset !== null) {
        if (asset.status !== 200) errors.push('The main asset returned ' + asset.status + '.');
        requireHeader(asset.headers, 'cache-control', 'immutable');
        const source = await asset.text();
        if (CONNECTION_STRING.test(source)) errors.push(credentialError('main asset'));
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

  const jwks = await fetchOrReport(target.origin + '/api/auth/jwks');
  if (jwks !== null) {
    if (jwks.status !== 200) {
      errors.push('The JWKS endpoint returned ' + jwks.status + '.');
    }
    if (!(jwks.headers.get('content-type') ?? '').includes('application/json')) {
      errors.push('The JWKS endpoint did not answer as JSON.');
    } else {
      const body = await jwks.json().catch(() => null);
      if (body === null || !Array.isArray(body.keys) || body.keys.length === 0) {
        errors.push('The JWKS endpoint returned no keys.');
      }
    }
  }

  const probe = await fetchOrReport(target.origin + '/api/__preview_check__', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  if (probe !== null) {
    if (probe.status !== 404) errors.push('The API probe returned ' + probe.status + ' instead of 404.');
    if (!(probe.headers.get('content-type') ?? '').includes('application/json')) {
      errors.push('The API probe did not answer as JSON.');
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
