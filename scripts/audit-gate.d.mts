export type AuditAdvisory = {
  id: string;
  package: string;
  title: string;
  severity: string;
  problem?: string;
};

export type AuditAllowlistEntry = {
  id: string;
  package: string;
  severity: string;
  reason: string;
  reviewBy: string;
};

export const AUDIT_ALLOWLIST: ReadonlyArray<AuditAllowlistEntry>;

export function collectAdvisories(report: unknown): AuditAdvisory[];

export function evaluateAudit(
  report: unknown,
  options?: { allowlist?: ReadonlyArray<AuditAllowlistEntry>; now?: Date },
): AuditAdvisory[];

export function runAudit(): unknown;

export function main(): void;
