import { describe, expect, it } from 'vitest';
import { AUDIT_ALLOWLIST, collectAdvisories, evaluateAudit } from '../../scripts/audit-gate.mjs';

const DOCUMENTED = 'GHSA-fc5q-39xc-vjpf';

function advisory(id: string, severity = 'high') {
  return {
    source: 1,
    name: 'picomatch',
    dependency: 'picomatch',
    title: 'Advisory ' + id,
    url: 'https://github.com/advisories/' + id,
    severity,
    range: '<=4.0.7',
  };
}

type Fixture = {
  advisories?: Array<{ package: string; entry: unknown }>;
  high?: number;
  critical?: number;
};

function report(options: Fixture = {}): unknown {
  const vulnerabilities: Record<string, unknown> = {};
  for (const { package: name, entry } of options.advisories
    ?? [{ package: 'picomatch', entry: advisory(DOCUMENTED) }]) {
    vulnerabilities[name] = { severity: 'high', via: [entry] };
  }
  return {
    auditReportVersion: 2,
    vulnerabilities,
    metadata: { vulnerabilities: { high: options.high ?? 1, critical: options.critical ?? 0 } },
  };
}

describe('the audit gate', () => {
  it('reads advisory objects and ignores dependency-chain names', () => {
    expect(collectAdvisories(report({
      advisories: [
        { package: 'picomatch', entry: advisory(DOCUMENTED) },
        { package: 'vite', entry: 'picomatch' },
      ],
    }))).toEqual([
      { id: DOCUMENTED, package: 'picomatch', title: 'Advisory ' + DOCUMENTED, severity: 'high' },
    ]);
  });

  it('lets the documented advisory through while its review date is current', () => {
    expect(evaluateAudit(report(), { now: new Date('2026-11-18T00:00:00Z') })).toEqual([]);
  });

  it('fails on a new advisory the allowlist does not mention', () => {
    const failures = evaluateAudit(report({
      advisories: [
        { package: 'picomatch', entry: advisory(DOCUMENTED) },
        { package: 'vite', entry: advisory('GHSA-aaaa-bbbb-cccc') },
      ],
      high: 2,
    }));

    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({
      id: 'GHSA-aaaa-bbbb-cccc',
      package: 'vite',
      problem: 'is not allowlisted',
    });
  });

  it('fails when an advisory escalates past the allowlisted severity', () => {
    const failures = evaluateAudit(report({
      advisories: [{ package: 'picomatch', entry: advisory(DOCUMENTED, 'critical') }],
      critical: 1,
      high: 0,
    }));

    expect(failures).toHaveLength(1);
    expect(failures[0].problem).toBe('no longer matches the allowlisted severity high');
  });

  it('fails once the allowlist review date has passed', () => {
    const failures = evaluateAudit(report(), { now: new Date('2027-03-01T00:00:00Z') });

    expect(failures).toHaveLength(1);
    expect(failures[0].problem).toBe('has an allowlist entry whose review date has passed');
  });

  it('fails an allowlist entry that carries no reason', () => {
    const failures = evaluateAudit(report(), {
      allowlist: [{ ...AUDIT_ALLOWLIST[0], reason: ' ' }],
      now: new Date('2026-11-18T00:00:00Z'),
    });

    expect(failures[0].problem).toBe('has an allowlist entry without a reason');
  });

  it('fails closed when blocking counts cannot be parsed', () => {
    const failures = evaluateAudit({
      vulnerabilities: {},
      metadata: { vulnerabilities: { high: 1, critical: 0 } },
    });

    expect(failures[0]).toMatchObject({ id: 'UNPARSED-AUDIT-REPORT', problem: 'cannot be evaluated' });
  });

  it('passes a report with no blocking advisories', () => {
    expect(evaluateAudit({
      vulnerabilities: {},
      metadata: { vulnerabilities: { high: 0, critical: 0 } },
    })).toEqual([]);
  });
});
