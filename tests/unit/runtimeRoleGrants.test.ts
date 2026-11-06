import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The app connects as echo_service and pgTAP runs as the table owner, so a
 * migration that grants a new function to service_role but not to the runtime
 * role answers every request with SQLSTATE 42501 while the whole database suite
 * stays green. That is how the songbook shipped broken on 2026-10-25.
 *
 * The live parity suite compares privileges on a real branch and so covers every
 * function, including the ones created before the rotation. This suite is the
 * offline half: it reads the migration text, so it bites at `npm test` time, in
 * seconds, without a Neon branch or CI secrets.
 */
const MIGRATIONS = 'supabase/migrations';
const RUNTIME_ROLE = 'echo_service';
const SERVICE_ROLE = 'service_role';

// 0034 is the first migration that grants the runtime role, because the rotation
// copied service_role's then-current surface onto echo_service outside of any
// migration. Grants before that number are not in the repo to check, and the
// boundary test below re-proves the premise instead of trusting this constant.
const RUNTIME_GRANTS_FROM = 34;

const GRANT = /grant execute on function ([a-z_]+)\.([a-z_]+)\([\s\S]*?\)\s+to\s+([^;]+);/gi;

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS).filter((name) => name.endsWith('.sql')).sort();
}

/**
 * Function names that a role was granted execute on, keyed as `schema.name`,
 * from the runtime-grant window onward. DO-block grants are written as
 * `execute 'grant ... to echo_service'`, so the trailing quote belongs to the
 * role list and is stripped rather than parsed around.
 */
function grantedTo(role: string, from = RUNTIME_GRANTS_FROM): Set<string> {
  const found = new Set<string>();
  for (const file of migrationFiles()) {
    if (Number.parseInt(file, 10) < from) continue;
    const text = readFileSync(`${MIGRATIONS}/${file}`, 'utf8');
    for (const match of text.matchAll(GRANT)) {
      const roles = match[3].toLowerCase().replace(/[\s']/g, '');
      if (roles.includes(role)) found.add(`${match[1].toLowerCase()}.${match[2].toLowerCase()}`);
    }
  }
  return found;
}

describe('runtime role grant boundary', () => {
  it('finds grants for both roles, so a stalled pattern cannot compare two empty sets', () => {
    // 13 service_role functions and 22 runtime grants in the window today. The
    // floors exist only so a renamed or reframed grant statement fails loudly
    // instead of shrinking the comparison to nothing.
    expect(grantedTo(SERVICE_ROLE).size).toBeGreaterThanOrEqual(12);
    expect(grantedTo(RUNTIME_ROLE).size).toBeGreaterThanOrEqual(20);
  });

  it('grants the runtime role every public function service_role received', () => {
    // Only the public schema is reachable by name from the app, which is what the
    // private-schema test below proves; comparing private functions here would
    // report a 42501 that cannot happen.
    const reachableByServiceRole = [...grantedTo(SERVICE_ROLE)].filter((fn) => fn.startsWith('public.'));
    const reachableByRuntimeRole = grantedTo(RUNTIME_ROLE);
    expect(reachableByServiceRole.filter((fn) => !reachableByRuntimeRole.has(fn))).toEqual([]);
  });

  it('keeps the private schema out of the comparison for a reason', () => {
    // The Node client can only name public functions: operationCall interpolates
    // the validated name into `select public.${name}(...)`, so a private helper is
    // reachable by nothing the app runs and a missing grant there is not a 42501.
    const client = readFileSync('server/db/client.ts', 'utf8');
    expect(client).toContain('select public.${name}');

    const privateGrants = [...grantedTo(SERVICE_ROLE)].filter((fn) => fn.startsWith('private.'));
    expect(privateGrants.length).toBeGreaterThan(0);
    expect(privateGrants.every((fn) => !fn.startsWith('public.'))).toBe(true);
  });

  it('starts the window where the repo copy of the runtime role starts', () => {
    const first = migrationFiles().find((file) => {
      const text = readFileSync(`${MIGRATIONS}/${file}`, 'utf8');
      return text.toLowerCase().includes(RUNTIME_ROLE);
    });
    // Without this, the constant above would silently decide that pre-rotation
    // migrations are exempt from a check they cannot pass.
    expect(first).toBeDefined();
    expect(Number.parseInt(first as string, 10)).toBe(RUNTIME_GRANTS_FROM);
  });
});
