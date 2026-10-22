import { describe, expect, it } from 'vitest';
import { operationCall } from '../../server/db/client';

describe('the operation call builder', () => {
  it('builds a parameterised call to the named operation', () => {
    const call = operationCall('queue_add', ['room-1', 'user-1', 'token-1']);
    expect(call.text).toContain('public.queue_add');
    expect(call.params).toEqual(['room-1', 'user-1', 'token-1']);
  });

  it('refuses an operation name that is not a plain identifier', () => {
    expect(() => operationCall('queue_add; drop table rooms', [])).toThrow(/operation/i);
  });
});
