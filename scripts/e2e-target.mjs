import { lookup } from 'node:dns/promises';

// The real-browser suite writes to whatever it is pointed at, and its previous
// default was `vercel dev` on loopback — a server whose database URLs name
// production Neon. Naming the target is mandatory, the production aliases are
// refused outright, and every other target is resolved before the suite starts
// so a loopback alias cannot hide behind a public-looking hostname.
const PRODUCTION_HOSTS = new Set([
  // The stable production domains and branch aliases. Preview deployments get
  // their own subdomain and their own PREVIEW_* database URLs, so they are not
  // listed here.
  'echo-karaoke-mocha.vercel.app',
  'echo-karaoke-ediwow110s-projects.vercel.app',
  'echo-karaoke-git-master-ediwow110s-projects.vercel.app',
]);

// A loopback port says nothing about the database behind it. Under `vercel dev`
// it is production Neon, so it needs an explicit statement that the port serves
// a disposable branch instead of a warning nobody has to read.
const CONFIRMATION = 'E2E_BRANCH_TARGET_CONFIRMED';
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '0.0.0.0', '[::1]', '::1']);

const GUIDANCE = 'The real-browser suite creates rooms, queue rows and catalog cursors wherever it points. '
  + 'The old default, `vercel dev` on http://127.0.0.1:3000, reads .env.local, whose database URLs name '
  + 'production Neon. Set E2E_BASE_URL to a disposable, branch-backed deployment first: '
  + 'docs/deployment/hosted-setup.md.';

function normalizedHost(hostname) {
  return hostname.toLowerCase().replace(/\.$/, '');
}

function hostFromUrl(value) {
  const raw = String(value ?? '').trim();
  if (raw.length === 0) {
    return null;
  }
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : 'https://' + raw);
    return normalizedHost(url.hostname);
  } catch {
    return null;
  }
}

function hostForLookup(hostname) {
  return hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;
}

function isLoopbackAddress(address) {
  const value = String(address).toLowerCase();
  if (value === '::1' || value === '0:0:0:0:0:0:0:1' || value === '0.0.0.0' || value === '::') {
    return true;
  }
  if (value.startsWith('127.')) {
    return true;
  }
  if (value.startsWith('::ffff:')) {
    const mapped = value.slice('::ffff:'.length);
    if (mapped.startsWith('127.')) {
      return true;
    }
    const parts = mapped.split(':');
    if (parts.length === 2) {
      const high = Number.parseInt(parts[0], 16);
      const low = Number.parseInt(parts[1], 16);
      if (Number.isInteger(high) && Number.isInteger(low)) {
        return ((high >> 8) & 0xff) === 127;
      }
    }
  }
  return false;
}

const defaultLookup = (hostname) => lookup(hostname, { all: true, verbatim: true });

/**
 * Resolves and validates the target the browser suites should drive. A trailing
 * slash is stripped so callers can keep appending paths.
 */
export async function resolveE2EBaseURL(env = process.env, lookupHost = defaultLookup) {
  const raw = (env.E2E_BASE_URL ?? '').trim();
  if (raw.length === 0) {
    throw new Error(`E2E_BASE_URL is required. ${GUIDANCE}`);
  }

  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`E2E_BASE_URL is not a URL: ${raw}. ${GUIDANCE}`);
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`E2E_BASE_URL must be an http(s) origin: ${raw}. ${GUIDANCE}`);
  }

  const targetHost = normalizedHost(url.hostname);
  const productionHosts = new Set([...PRODUCTION_HOSTS].map((host) => normalizedHost(host)));
  const authHost = hostFromUrl(env.BETTER_AUTH_URL);
  if (authHost !== null) {
    productionHosts.add(authHost);
  }
  if (productionHosts.has(targetHost)) {
    throw new Error(`E2E_BASE_URL names the production origin ${url.hostname}. ${GUIDANCE}`);
  }

  let loopbackAddress = LOOPBACK_HOSTS.has(targetHost) ? targetHost : null;
  if (loopbackAddress === null) {
    let addresses;
    try {
      addresses = await lookupHost(hostForLookup(targetHost));
    } catch {
      throw new Error(`E2E_BASE_URL host does not resolve: ${url.hostname}. ${GUIDANCE}`);
    }
    if (!Array.isArray(addresses) || addresses.length === 0) {
      throw new Error(`E2E_BASE_URL host does not resolve: ${url.hostname}. ${GUIDANCE}`);
    }
    const match = addresses.find((entry) => isLoopbackAddress(entry.address));
    if (match !== undefined) {
      loopbackAddress = match.address;
    }
  }

  if (loopbackAddress !== null) {
    if ((env[CONFIRMATION] ?? '').trim() !== '1') {
      throw new Error(
        `E2E_BASE_URL resolves to a local address (${url.hostname} -> ${loopbackAddress}), and nothing in a URL says which database answers it. `
        + `Under \`vercel dev\` that is production Neon. Set ${CONFIRMATION}=1 only when the port serves a `
        + `disposable branch, or point E2E_BASE_URL at a branch-backed deployment instead. ` + GUIDANCE,
      );
    }
    return url.href.replace(/\/+$/, '');
  }

  if (url.protocol !== 'https:') {
    throw new Error(`E2E_BASE_URL must use HTTPS for a remote target: ${raw}. ${GUIDANCE}`);
  }

  return url.href.replace(/\/+$/, '');
}
