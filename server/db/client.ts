import { neon } from '@neondatabase/serverless';

const OPERATION_NAME = /^[a-z_][a-z0-9_]*$/;

export function operationCall(name: string, params: unknown[]): { text: string; params: unknown[] } {
  if (!OPERATION_NAME.test(name)) {
    throw new Error(`the operation name is not a plain identifier: ${name}`);
  }
  return {
    text: `select * from public.${name}(${params.map((_, index) => `$${index + 1}`).join(', ')})`,
    params,
  };
}

export function serviceDatabase() {
  return neon(process.env.DATABASE_URL ?? '');
}

export function authDatabase() {
  return neon(process.env.AUTH_DATABASE_URL ?? '');
}
