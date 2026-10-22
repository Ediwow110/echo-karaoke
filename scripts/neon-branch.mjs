#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const API = 'https://console.neon.tech/api/v2';

function required(env, name) {
  const value = String(env[name] ?? '').trim();
  if (value.length === 0) {
    throw new Error(name + ' is required.');
  }
  return value;
}

function connectionTarget(url, name) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(name + ' is not a valid connection string.');
  }
  if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
    throw new Error(name + ' is not a PostgreSQL connection string.');
  }
  const database = parsed.pathname.replace(/^\//, '');
  if (database.length === 0 || parsed.username.length === 0) {
    throw new Error(name + ' must name a database and a role.');
  }
  return { database, role: decodeURIComponent(parsed.username) };
}

function headers(apiKey) {
  return {
    authorization: 'Bearer ' + apiKey,
    accept: 'application/json',
    'content-type': 'application/json',
  };
}

async function readJson(response, what) {
  if (!response.ok) {
    throw new Error(what + ' failed with status ' + response.status + '.');
  }
  return response.json();
}

async function connectionUri(options, branchId, target) {
  const query = new URLSearchParams({
    branch_id: branchId,
    database_name: target.database,
    role_name: target.role,
    pooled: 'false',
  });
  const response = await options.fetchImpl(
    API + '/projects/' + encodeURIComponent(options.projectId) + '/connection_uri?' + query,
    { headers: headers(options.apiKey) },
  );
  const body = await readJson(response, 'Reading the branch connection URI');
  if (typeof body?.uri !== 'string' || body.uri.length === 0) {
    throw new Error('Neon returned no connection URI for the branch.');
  }
  return body.uri;
}

export async function createBranch(options) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const owner = connectionTarget(options.ownerUrl, 'NEON_DATABASE_URL');
  const service = connectionTarget(options.serviceUrl, 'NEON_SERVICE_DATABASE_URL');
  const auth = connectionTarget(options.authUrl, 'NEON_AUTH_DATABASE_URL');
  const headersValue = headers(options.apiKey);

  const response = await fetchImpl(
    API + '/projects/' + encodeURIComponent(options.projectId) + '/branches',
    {
      method: 'POST',
      headers: headersValue,
      body: JSON.stringify({
        branch: { name: options.name },
        endpoints: [{ type: 'read_write' }],
      }),
    },
  );
  const body = await readJson(response, 'Creating the Neon branch');
  const branchId = body?.branch?.id;
  if (typeof branchId !== 'string' || branchId.length === 0) {
    throw new Error('Neon returned no branch id.');
  }

  const scoped = { ...options, fetchImpl };
  return {
    branchId,
    neonDatabaseUrl: await connectionUri(scoped, branchId, owner),
    serviceDatabaseUrl: await connectionUri(scoped, branchId, service),
    authDatabaseUrl: await connectionUri(scoped, branchId, auth),
  };
}

export async function deleteBranch(options) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(
    API + '/projects/' + encodeURIComponent(options.projectId)
      + '/branches/' + encodeURIComponent(options.branchId),
    { method: 'DELETE', headers: headers(options.apiKey) },
  );
  if (response.status === 404) {
    return false;
  }
  if (!response.ok) {
    throw new Error('Deleting the Neon branch failed with status ' + response.status + '.');
  }
  return true;
}

function setOutput(name, value) {
  const path = process.env.GITHUB_OUTPUT;
  if (path === undefined || path.length === 0) {
    return;
  }
  appendFileSync(path, name + '=' + value + '\n');
}

export function mask(value) {
  console.log('::add-mask::' + value);
}

export async function main(args = process.argv.slice(2), env = process.env) {
  const command = args[0] ?? '';
  try {
    const apiKey = required(env, 'NEON_API_KEY');
    const projectId = required(env, 'NEON_PROJECT_ID');

    if (command === 'create') {
      const ownerUrl = required(env, 'NEON_DATABASE_URL');
      const serviceUrl = required(env, 'NEON_SERVICE_DATABASE_URL');
      const authUrl = required(env, 'NEON_AUTH_DATABASE_URL');
      const name = (env.BRANCH_NAME ?? '').trim()
        || 'ci-' + Date.now().toString(36);
      const branch = await createBranch({
        apiKey,
        projectId,
        ownerUrl,
        serviceUrl,
        authUrl,
        name,
      });
      for (const uri of [branch.neonDatabaseUrl, branch.serviceDatabaseUrl, branch.authDatabaseUrl]) {
        mask(uri);
      }
      setOutput('branch_id', branch.branchId);
      setOutput('neon_database_url', branch.neonDatabaseUrl);
      setOutput('database_url', branch.serviceDatabaseUrl);
      setOutput('auth_database_url', branch.authDatabaseUrl);
      console.log('Created Neon branch ' + name + ' (' + branch.branchId + ').');
      return;
    }

    if (command === 'delete') {
      const branchId = (env.BRANCH_ID ?? '').trim();
      if (branchId.length === 0) {
        console.log('No Neon branch to delete.');
        return;
      }
      const deleted = await deleteBranch({ apiKey, projectId, branchId });
      console.log(deleted
        ? 'Deleted Neon branch ' + branchId + '.'
        : 'Neon branch ' + branchId + ' was already gone.');
      return;
    }

    throw new Error('Usage: neon-branch.mjs create | delete');
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'The Neon branch command failed.');
    process.exitCode = 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
