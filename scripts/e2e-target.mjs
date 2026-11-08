// The real-browser suite writes to whatever it is pointed at, and its previous
// default was `vercel dev` on loopback — a server whose database URLs name
// production Neon. Naming the target is now mandatory, and the documented
// production origin is refused outright rather than warned about, because a run
// against it is indistinguishable from a live user session once it writes.
const PRODUCTION_HOSTS = new Set([
  // The deployed origin, as pinned by BETTER_AUTH_URL and ALLOWED_ORIGINS in
  // docs/deployment/hosted-setup.md. Preview deployments get their own subdomain
  // and their own PREVIEW_* database URLs, so they are not listed here.
  'echo-karaoke-mocha.vercel.app',
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

/**
 * Returns the base URL the browser suites should drive, or refuses to return one.
 * A trailing slash is stripped so callers can keep appending paths.
 */
export function resolveE2EBaseURL(env = process.env) {
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

  if (PRODUCTION_HOSTS.has(url.hostname)) {
    throw new Error(`E2E_BASE_URL names the production origin ${url.hostname}. ${GUIDANCE}`);
  }

  if (LOOPBACK_HOSTS.has(url.hostname) && (env[CONFIRMATION] ?? '').trim() !== '1') {
    throw new Error(
      `E2E_BASE_URL names a local port (${url.hostname}), and nothing in a URL says which database answers it. `
      + `Under \`vercel dev\` that is production Neon. Set ${CONFIRMATION}=1 only when the port serves a `
      + `disposable branch, or point E2E_BASE_URL at a branch-backed deployment instead. ` + GUIDANCE,
    );
  }

  return url.href.replace(/\/+$/, '');
}
