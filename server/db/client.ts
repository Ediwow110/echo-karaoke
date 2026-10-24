import { neon } from '@neondatabase/serverless';

const OPERATION_NAME = /^[a-z_][a-z0-9_]*$/;

export function operationCall(name: string, params: unknown[]): { text: string; params: unknown[] } {
  if (!OPERATION_NAME.test(name)) {
    throw new Error(`the operation name is not a plain identifier: ${name}`);
  }
  return {
    text: `select public.${name}(${params.map((_, index) => `$${index + 1}`).join(', ')}) as result`,
    params,
  };
}

export function databaseUrlFor(
  env: Record<string, string | undefined> = process.env,
): string {
  if (env.VERCEL_ENV === 'preview') {
    return env.PREVIEW_DATABASE_URL ?? '';
  }
  return env.DATABASE_URL ?? '';
}

export function serviceDatabase() {
  return neon(databaseUrlFor());
}
