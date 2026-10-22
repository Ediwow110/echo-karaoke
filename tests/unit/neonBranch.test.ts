import { describe, expect, it, vi } from 'vitest';
import { createBranch, deleteBranch } from '../../scripts/neon-branch.mjs';

const base = {
  apiKey: 'neon-key',
  projectId: 'project-1',
  name: 'ci-test',
  ownerUrl: 'postgresql://owner:secret@main.example/neondb',
  serviceUrl: 'postgresql://service_role:secret@main.example/neondb',
  authUrl: 'postgresql://echo_auth:secret@main.example/neondb',
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('Neon CI branch', () => {
  it('creates a branch and resolves one connection URI per role', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.endsWith('/projects/project-1/branches')) {
        return jsonResponse(201, { branch: { id: 'br-ci' } });
      }
      const role = new URL(url).searchParams.get('role_name');
      return jsonResponse(200, {
        uri: 'postgresql://' + role + ':fresh@br-ci.example/neondb?sslmode=require&channel_binding=require',
      });
    }) as unknown as typeof fetch;

    const branch = await createBranch({ ...base, fetchImpl });

    expect(branch).toEqual({
      branchId: 'br-ci',
      neonDatabaseUrl: 'postgresql://owner:fresh@br-ci.example/neondb?sslmode=require',
      serviceDatabaseUrl: 'postgresql://service_role:fresh@br-ci.example/neondb?sslmode=require',
      authDatabaseUrl: 'postgresql://echo_auth:fresh@br-ci.example/neondb?sslmode=require',
    });
    const create = calls[0];
    expect(create.url).toBe('https://console.neon.tech/api/v2/projects/project-1/branches');
    expect(create.init?.method).toBe('POST');
    expect(JSON.parse(String(create.init?.body))).toEqual({
      branch: { name: 'ci-test' },
      endpoints: [{ type: 'read_write' }],
    });
    expect((create.init?.headers as Record<string, string>).authorization).toBe('Bearer neon-key');
    expect(calls).toHaveLength(4);
  });

  it('rejects a non-Postgres connection string without calling Neon', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    await expect(createBranch({ ...base, ownerUrl: 'https://main.example', fetchImpl }))
      .rejects.toThrow('NEON_DATABASE_URL is not a PostgreSQL connection string.');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('reports a failed branch creation without echoing a credential', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(401, { message: 'bad key' })) as unknown as typeof fetch;
    await expect(createBranch({ ...base, fetchImpl })).rejects.toThrow(
      'Creating the Neon branch failed with status 401.',
    );
    await expect(createBranch({ ...base, fetchImpl })).rejects.not.toThrow(/postgresql:\/\//);
  });

  it('deletes a branch and treats a missing branch as already gone', async () => {
    const deleted = vi.fn(async () => new Response(null, { status: 200 })) as unknown as typeof fetch;
    await expect(deleteBranch({ ...base, branchId: 'br-ci', fetchImpl: deleted })).resolves.toBe(true);

    const missing = vi.fn(async () => new Response(null, { status: 404 })) as unknown as typeof fetch;
    await expect(deleteBranch({ ...base, branchId: 'br-ci', fetchImpl: missing })).resolves.toBe(false);
  });
});
