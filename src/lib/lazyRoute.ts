import { lazy, type ComponentType } from 'react';

// A route chunk can fail for reasons that have nothing to do with the screen: a
// quick navigation aborts the in-flight request (Firefox reports
// NS_BINDING_ABORTED), a proxy drops the response, a phone loses signal. React
// caches a lazy component's rejection for its lifetime, so a single aborted
// request would leave the error boundary on screen until the page reloads.
// Retrying inside the same promise keeps a transient failure from becoming a
// permanent one; only three failures in a row reach the boundary.
export function lazyRoute<T extends ComponentType<any>>(load: () => Promise<{ default: T }>) {
  return lazy(async () => {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await load();
      } catch (error) {
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)));
      }
    }
    throw lastError;
  });
}
