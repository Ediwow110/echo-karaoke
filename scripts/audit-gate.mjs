#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// Advisory IDs that may pass the high/critical gate. Every entry carries the
// reason it is acceptable and the date the decision must be reviewed: a new
// advisory, an expired entry, or a missing reason still fails the build.
export const AUDIT_ALLOWLIST = Object.freeze([
  Object.freeze({
    id: 'GHSA-fc5q-39xc-vjpf',
    package: 'picomatch',
    severity: 'high',
    reason: 'ReDoS in build and test tooling only: picomatch is reached through Vite and Vitest, which run in CI and never ship in the deployed function. No patched release exists (the advisory covers every published version; 4.0.7 is the latest), so the alternative today is a breaking toolchain downgrade.',
    reviewBy: '2027-02-28',
  }),
]);

const BLOCKING_SEVERITIES = new Set(['high', 'critical']);

function advisoryId(entry) {
  const match = /GHSA-[a-z0-9-]+/i.exec(String(entry?.url ?? ''));
  return match?.[0] ?? null;
}

// npm reports one advisory object under the package that carries it; every
// other entry in `via` is a dependent package name. Collect the objects so an
// allowlist decision is made per advisory, not per affected package.
export function collectAdvisories(report) {
  const advisories = new Map();
  for (const [packageName, vulnerability] of Object.entries(report?.vulnerabilities ?? {})) {
    const via = Array.isArray(vulnerability?.via) ? vulnerability.via : [];
    for (const entry of via) {
      if (entry === null || typeof entry !== 'object') {
        continue;
      }
      const id = advisoryId(entry);
      if (id === null) {
        continue;
      }
      const key = id + '\u0000' + packageName;
      if (!advisories.has(key)) {
        advisories.set(key, {
          id,
          package: packageName,
          title: typeof entry.title === 'string' ? entry.title : id,
          severity: typeof entry.severity === 'string' ? entry.severity : 'unknown',
        });
      }
    }
  }
  return [...advisories.values()];
}

export function evaluateAudit(report, { allowlist = AUDIT_ALLOWLIST, now = new Date() } = {}) {
  const blocking = collectAdvisories(report)
    .filter((advisory) => BLOCKING_SEVERITIES.has(advisory.severity));
  const declaredBlocking = Number(report?.metadata?.vulnerabilities?.high ?? 0)
    + Number(report?.metadata?.vulnerabilities?.critical ?? 0);
  if (declaredBlocking > 0 && blocking.length === 0) {
    // A report shape this gate cannot read must not pass by yielding nothing.
    return [{
      id: 'UNPARSED-AUDIT-REPORT',
      package: 'npm',
      severity: 'high',
      title: 'The audit reported blocking vulnerabilities but none could be parsed',
      problem: 'cannot be evaluated',
    }];
  }

  const failures = [];
  for (const advisory of blocking) {
    const entry = allowlist.find((candidate) => candidate.id === advisory.id
      && candidate.package === advisory.package);
    if (entry === undefined) {
      failures.push({ ...advisory, problem: 'is not allowlisted' });
      continue;
    }
    if (entry.severity !== advisory.severity) {
      failures.push({ ...advisory, problem: 'no longer matches the allowlisted severity ' + entry.severity });
      continue;
    }
    if (typeof entry.reason !== 'string' || entry.reason.trim().length < 20) {
      failures.push({ ...advisory, problem: 'has an allowlist entry without a reason' });
      continue;
    }
    const reviewBy = Date.parse(entry.reviewBy);
    if (!Number.isFinite(reviewBy) || reviewBy < now.getTime()) {
      failures.push({ ...advisory, problem: 'has an allowlist entry whose review date has passed' });
    }
  }
  return failures;
}

function auditCommand() {
  const npmCli = process.env.npm_execpath;
  if (typeof npmCli === 'string' && npmCli.endsWith('.js')) {
    return { command: process.execPath, args: [npmCli, 'audit', '--json'] };
  }
  if (process.platform === 'win32') {
    // Node refuses to spawn a .cmd shim without a shell; use cmd.exe directly so
    // no arguments are concatenated through a shell.
    return { command: process.env.ComSpec ?? 'cmd.exe', args: ['/d', '/s', '/c', 'npm audit --json'] };
  }
  return { command: 'npm', args: ['audit', '--json'] };
}

export function runAudit() {
  const { command, args } = auditCommand();
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
  if (typeof result.stdout !== 'string' || result.stdout.trim().length === 0) {
    const detail = result.error === undefined ? '' : ': ' + result.error.message;
    throw new Error('npm audit produced no JSON' + detail);
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error('npm audit produced unreadable JSON');
  }
}

export function main() {
  let report;
  try {
    report = runAudit();
  } catch (error) {
    console.error('Audit gate could not run: ' + (error instanceof Error ? error.message : String(error)));
    process.exitCode = 1;
    return;
  }

  const failures = evaluateAudit(report);
  if (failures.length > 0) {
    console.error('Unreviewed high or critical advisories:');
    for (const failure of failures) {
      console.error('- ' + failure.id + ' (' + failure.package + ', ' + failure.severity + ') '
        + failure.problem + '.');
    }
    process.exitCode = 1;
    return;
  }
  for (const advisory of collectAdvisories(report)) {
    if (BLOCKING_SEVERITIES.has(advisory.severity)) {
      console.log('Allowlisted: ' + advisory.id + ' (' + advisory.package + ').');
    }
  }
  console.log('No unreviewed high or critical advisories.');
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
