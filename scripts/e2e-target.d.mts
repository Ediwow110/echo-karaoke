type E2ELookupAddress = { address: string };

export function resolveE2EBaseURL(
  env?: Record<string, string | undefined>,
  lookupHost?: (hostname: string) => Promise<E2ELookupAddress[]>,
): Promise<string>;
