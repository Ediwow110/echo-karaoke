import { describe, expect, it } from 'vitest';
import { checkIntegrationTarget } from '../../scripts/integration-target.mjs';

const credentials = {
  DATABASE_URL: 'postgresql://service@ep-disposable/db',
  AUTH_DATABASE_URL: 'postgresql://auth@ep-disposable-auth/db',
  BETTER_AUTH_SECRET: 'x'.repeat(40),
};

describe('integration target guard', () => {
  it('stays out of the way when the suite will skip', () => {
    expect(checkIntegrationTarget({})).toEqual([]);
  });

  it('requires explicit confirmation when credentials are present', () => {
    const errors = checkIntegrationTarget(credentials);
    expect(errors.some((message) => message.includes('INTEGRATION_TARGET_CONFIRMED'))).toBe(true);
  });

  it('accepts an explicitly confirmed disposable target', () => {
    expect(checkIntegrationTarget({
      ...credentials,
      INTEGRATION_TARGET_CONFIRMED: '1',
    })).toEqual([]);
  });
});
